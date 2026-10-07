// Deterministic generator for the two mock systems. Everything here is synthetic:
// people, companies, deals and tickets are made up from a seeded faker instance.
import { Faker, base, en } from "@faker-js/faker";

export const REGIONS = ["EMEA", "NA", "APAC"] as const;
export type Region = (typeof REGIONS)[number];
export const STAGES = ["prospecting", "qualification", "proposal", "negotiation", "closed_won", "closed_lost"] as const;
export const QUARTERS = ["2026-Q2", "2026-Q3", "2026-Q4"] as const;
/** The quarter the scripted session asks about. Fixed so runs don't depend on the clock. */
export const CURRENT_QUARTER = "2026-Q3";

export type CrmRole = "manager" | "rep" | "support";

export interface Person {
  id: number;
  name: string;
  email: string;
  crmUserId: number;
  ticketsUserId: number;
  crmRole: CrmRole;
  region: Region | null;
  /** CRM user id of this person's manager, if any. */
  crmManagerId: number | null;
}

export interface Account { id: number; name: string; region: Region; owner_id: number; industry: string }
export interface Contact { id: number; account_id: number; name: string; email: string; title: string; region: Region; owner_id: number }
export interface Opportunity {
  id: number; account_id: number; name: string; region: Region; owner_id: number;
  stage: string; amount: number; discount_floor: string; close_quarter: string;
}
export interface Activity { id: number; opportunity_id: number; subject: string; kind: string; region: Region; owner_id: number }
export interface Project { id: number; key: string; name: string }
export interface Ticket { id: number; project_id: number; title: string; body: string; status: string; priority: string; reporter_id: number }
export interface Comment { id: number; ticket_id: number; author_id: number; body: string }

export interface World {
  seed: number;
  people: Person[];
  crm: { accounts: Account[]; contacts: Contact[]; opportunities: Opportunity[]; activities: Activity[] };
  tickets: { projects: Project[]; members: { project_id: number; user_id: number }[]; tickets: Ticket[]; comments: Comment[] };
  /** The people the scripted session acts as, and the records it targets. */
  personas: { rep: number; manager: number; support: number; approver: number };
  targets: { escalationTicketId: number };
}

const CRM_USER_BASE = 5000;
const TICKETS_USER_BASE = 9000;

export function generateWorld(seed: number): World {
  const f = new Faker({ locale: [en, base] });
  f.seed(seed);
  f.setDefaultRefDate("2026-07-01T00:00:00.000Z");

  const people: Person[] = [];
  const addPerson = (crmRole: CrmRole, region: Region | null, crmManagerId: number | null): Person => {
    const id = people.length + 1;
    const first = f.person.firstName();
    const last = f.person.lastName();
    const p: Person = {
      id,
      name: `${first} ${last}`,
      email: `${first}.${last}.${id}@example.test`.toLowerCase(),
      crmUserId: CRM_USER_BASE + id,
      ticketsUserId: TICKETS_USER_BASE + id,
      crmRole,
      region,
      crmManagerId,
    };
    people.push(p);
    return p;
  };

  // Sales: one director over three regional managers, each with three reps.
  const director = addPerson("manager", null, null);
  const regionalManagers = new Map<Region, Person>();
  const repsByRegion = new Map<Region, Person[]>();
  for (const region of REGIONS) {
    const m = addPerson("manager", region, director.crmUserId);
    regionalManagers.set(region, m);
    repsByRegion.set(region, [0, 1, 2].map(() => addPerson("rep", region, m.crmUserId)));
  }
  const supportAgents = [0, 1, 2].map(() => addPerson("support", null, null));

  // Restricted values: distinct 4-significant-digit floors that end in a nonzero digit,
  // so each one has a single canonical rendering and can't collide with other data.
  const floorPool: string[] = [];
  for (let n = 1001; n <= 2999; n++) if (n % 10 !== 0) floorPool.push((n / 10000).toFixed(4));
  const floors = f.helpers.shuffle(floorPool);

  const accounts: Account[] = [];
  const contacts: Contact[] = [];
  const opportunities: Opportunity[] = [];
  const activities: Activity[] = [];
  for (const region of REGIONS) {
    const reps = repsByRegion.get(region)!;
    for (let i = 0; i < 20; i++) {
      const owner = reps[i % reps.length]!;
      const account: Account = {
        id: accounts.length + 1,
        name: `${f.company.name()} (${region})`,
        region,
        owner_id: owner.crmUserId,
        industry: f.commerce.department(),
      };
      accounts.push(account);
      for (let c = 0; c < 2; c++) {
        const first = f.person.firstName();
        const last = f.person.lastName();
        contacts.push({
          id: contacts.length + 1,
          account_id: account.id,
          name: `${first} ${last}`,
          email: `${first}.${last}@${account.id}.example.test`.toLowerCase(),
          title: f.person.jobTitle(),
          region,
          owner_id: owner.crmUserId,
        });
      }
      for (let o = 0; o < 3; o++) {
        const opp: Opportunity = {
          id: opportunities.length + 1,
          account_id: account.id,
          name: `${account.name.replace(/ \(.*\)$/, "")} ${f.commerce.productName()}`,
          region,
          owner_id: owner.crmUserId,
          stage: f.helpers.arrayElement(STAGES),
          amount: f.number.int({ min: 10, max: 400 }) * 1000,
          discount_floor: floors[opportunities.length]!,
          close_quarter: f.helpers.arrayElement(QUARTERS),
        };
        opportunities.push(opp);
        activities.push({
          id: activities.length + 1,
          opportunity_id: opp.id,
          subject: `${f.helpers.arrayElement(["Call", "Demo", "Email", "Meeting"])} with ${account.name.replace(/ \(.*\)$/, "")}`,
          kind: f.helpers.arrayElement(["call", "demo", "email", "meeting"]),
          region,
          owner_id: owner.crmUserId,
        });
      }
    }
  }

  // Ticket desk. Support works SUP; escalations (ESC) also include EMEA sales and the director.
  const projects: Project[] = [
    { id: 1, key: "SUP", name: "Customer support" },
    { id: 2, key: "ESC", name: "Escalations" },
    { id: 3, key: "ENG", name: "Engineering requests" },
  ];
  const tid = (p: Person) => p.ticketsUserId;
  const emeaSales = [regionalManagers.get("EMEA")!, ...repsByRegion.get("EMEA")!];
  const members = [
    ...supportAgents.map((p) => ({ project_id: 1, user_id: tid(p) })),
    ...[...supportAgents, director, ...emeaSales].map((p) => ({ project_id: 2, user_id: tid(p) })),
    { project_id: 3, user_id: tid(supportAgents[0]!) },
  ];

  const tickets: Ticket[] = [];
  const comments: Comment[] = [];
  const statuses = ["open", "in_progress", "waiting", "resolved"];
  const addTicket = (project: Project, title: string, reporter: Person): Ticket => {
    const t: Ticket = {
      id: tickets.length + 1,
      project_id: project.id,
      title,
      body: f.lorem.sentences(2),
      status: f.helpers.arrayElement(statuses),
      priority: f.helpers.arrayElement(["low", "normal", "high"]),
      reporter_id: tid(reporter),
    };
    tickets.push(t);
    return t;
  };
  for (let i = 0; i < 30; i++) addTicket(projects[0]!, `${f.hacker.verb()} ${f.hacker.noun()} not working`, f.helpers.arrayElement(supportAgents));
  const emeaAccounts = accounts.filter((a) => a.region === "EMEA");
  let target: Ticket | undefined;
  for (let i = 0; i < 10; i++) {
    const acct = emeaAccounts[i]!;
    const t = addTicket(projects[1]!, `Escalation: ${acct.name} renewal at risk`, f.helpers.arrayElement(supportAgents));
    if (i === 0) {
      t.status = "open";
      target = t;
    }
  }
  for (let i = 0; i < 10; i++) addTicket(projects[2]!, `Request: ${f.hacker.phrase()}`, supportAgents[0]!);
  for (const t of tickets) {
    const n = f.number.int({ min: 1, max: 2 });
    for (let c = 0; c < n; c++) {
      comments.push({ id: comments.length + 1, ticket_id: t.id, author_id: t.reporter_id, body: f.lorem.sentence() });
    }
  }

  const emeaReps = repsByRegion.get("EMEA")!;
  return {
    seed,
    people,
    crm: { accounts, contacts, opportunities, activities },
    tickets: { projects, members, tickets, comments },
    personas: {
      rep: emeaReps[0]!.id,
      manager: director.id,
      support: supportAgents[1]!.id,
      approver: regionalManagers.get("EMEA")!.id,
    },
    targets: { escalationTicketId: target!.id },
  };
}

export function personById(world: World, id: number): Person {
  const p = world.people.find((x) => x.id === id);
  if (!p) throw new Error(`unknown person ${id}`);
  return p;
}
