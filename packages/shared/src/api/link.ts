/**
 * A hypermedia link in `_links`. An action link appears only when the server
 * would accept that action now (specs/api-conventions.md, section 2).
 */
export interface Link {
  /** Path; an RFC 6570 template when `templated`. */
  href: string;
  /** Default GET. */
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** A label the UI may use. */
  title?: string;
  templated?: boolean;
  /** Headers or body fields the action needs: If-Match, Idempotency-Key, reasonCode. */
  requires?: string[];
}

export type Links = Record<string, Link>;
