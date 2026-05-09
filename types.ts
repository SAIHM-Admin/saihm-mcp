/**
 * SAIHM MCP — public type surface for sharing tool parameters.
 * Operators implementing the SAIHM runtime endpoint must honour these.
 */

export enum SharingContractType {
  TEMPORARY = "temporary",
  PERMANENT = "permanent",
  SYNDICATE = "syndicate",
}

export type SharingContractScope = "read" | "write" | "readwrite";
