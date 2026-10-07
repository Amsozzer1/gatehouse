export type SystemName = "crm" | "tickets";

export interface EntitySpec {
  system: SystemName;
  /** Plural name used in tool names, e.g. list_opportunities. */
  plural: string;
  singular: string;
  table: string;
  columns: string[];
  /** Entities with a region column honour the `region` param on every read tool. */
  hasRegion: boolean;
  filterable: string[];
  searchable: string[];
  writable: string[];
}

export const ENTITIES: EntitySpec[] = [
  {
    system: "crm", plural: "accounts", singular: "account", table: "crm.accounts",
    columns: ["id", "name", "region", "owner_id", "industry"], hasRegion: true,
    filterable: ["owner_id", "industry"], searchable: ["name", "industry"], writable: ["name", "region", "owner_id", "industry"],
  },
  {
    system: "crm", plural: "contacts", singular: "contact", table: "crm.contacts",
    columns: ["id", "account_id", "name", "email", "title", "region", "owner_id"], hasRegion: true,
    filterable: ["account_id", "owner_id"], searchable: ["name", "email", "title"], writable: ["account_id", "name", "email", "title", "region", "owner_id"],
  },
  {
    system: "crm", plural: "opportunities", singular: "opportunity", table: "crm.opportunities",
    columns: ["id", "account_id", "name", "region", "owner_id", "stage", "amount", "discount_floor", "close_quarter"], hasRegion: true,
    filterable: ["account_id", "owner_id", "stage", "close_quarter"], searchable: ["name"],
    writable: ["account_id", "name", "region", "owner_id", "stage", "amount", "discount_floor", "close_quarter"],
  },
  {
    system: "crm", plural: "activities", singular: "activity", table: "crm.activities",
    columns: ["id", "opportunity_id", "subject", "kind", "region", "owner_id"], hasRegion: true,
    filterable: ["opportunity_id", "owner_id", "kind"], searchable: ["subject"], writable: ["opportunity_id", "subject", "kind", "region", "owner_id"],
  },
  {
    system: "tickets", plural: "tickets", singular: "ticket", table: "tickets.tickets",
    columns: ["id", "project_id", "title", "body", "status", "priority", "reporter_id"], hasRegion: false,
    filterable: ["project_id", "status", "priority"], searchable: ["title", "body"], writable: ["project_id", "title", "body", "status", "priority"],
  },
  {
    system: "tickets", plural: "comments", singular: "comment", table: "tickets.comments",
    columns: ["id", "ticket_id", "author_id", "body"], hasRegion: false,
    filterable: ["ticket_id", "author_id"], searchable: ["body"], writable: ["ticket_id", "body"],
  },
];

export const entity = (system: SystemName, plural: string): EntitySpec => {
  const e = ENTITIES.find((x) => x.system === system && x.plural === plural);
  if (!e) throw new Error(`unknown entity ${system}.${plural}`);
  return e;
};
