import {describe,expect,it,vi} from "vitest";
import {createOrganizationInvitation,acceptOrganizationInvitation,listOrganizationInvitations,InvitationError} from "../src/postgres-invitations-repository.js";
import {hashPassword} from "../src/password-hashing.js";
vi.mock("../src/password-hashing.js",async(importOriginal)=>{
 const actual=await importOriginal<typeof import("../src/password-hashing.js")>();
 return {...actual,hashPassword:vi.fn(actual.hashPassword)};
});
const org="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",actor="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
describe("Inviti organizzazione",()=>{
 it("valida i dati prima di aprire la connessione",async()=>{
  const connect=vi.fn();
  await expect(createOrganizationInvitation({connect} as never,org,actor,{email:"no",role:"editor"})).rejects.toBeInstanceOf(InvitationError);
  await expect(createOrganizationInvitation({connect} as never,org,actor,{email:"user@example.test",role:"owner"})).rejects.toBeInstanceOf(InvitationError);
  await expect(acceptOrganizationInvitation({connect} as never,{token:"invalid",fullName:"Utente",password:"Password-Lunga-2026"})).rejects.toBeInstanceOf(InvitationError);
  await expect(listOrganizationInvitations({connect} as never,"bad")).rejects.toBeInstanceOf(InvitationError);
  expect(connect).not.toHaveBeenCalled();
 });
 it("non esegue scrypt prima di verificare un token invito valido",async()=>{
  vi.mocked(hashPassword).mockClear();
  const client={query:vi.fn(async(sql:string)=>{
   if(sql.includes("SELECT i.id::text AS id"))return {rows:[],rowCount:0};
   return {rows:[],rowCount:1};
  }),release:vi.fn()};
  const pool={connect:vi.fn(async()=>client)} as never;
  await expect(acceptOrganizationInvitation(pool,{token:"A".repeat(43),fullName:"Utente",password:"Password-Lunga-2026"})).rejects.toBeInstanceOf(InvitationError);
  expect(hashPassword).not.toHaveBeenCalled();
  expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  expect(client.release).toHaveBeenCalledOnce();
 });
 it("restituisce un token monouso opaco e non espone il suo hash nei record",async()=>{
  const calls:string[]=[];
  const client={query:vi.fn(async(sql:string)=>{
   calls.push(sql);
   if(sql.includes("SELECT 1 FROM memberships"))return {rows:[],rowCount:0};
   if(sql.includes("SELECT 1 FROM invitations"))return {rows:[],rowCount:0};
   if(sql.includes("INSERT INTO invitations"))return {rows:[{id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",email:"user@example.test",role:"editor",status:"pending",createdAt:"2026-01-01T00:00:00Z",expiresAt:"2026-01-08T00:00:00Z",acceptedAt:null,revokedAt:null}],rowCount:1};
   return {rows:[],rowCount:1};
  }),release:vi.fn()};
  const pool={connect:vi.fn(async()=>client)} as never;
  const result=await createOrganizationInvitation(pool,org,actor,{email:"User@example.test",role:"editor"});
  expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(result.invitation).not.toHaveProperty("tokenHash");
  expect(calls.some(sql=>sql.includes("INSERT INTO audit_logs"))).toBe(true);
 });
});
