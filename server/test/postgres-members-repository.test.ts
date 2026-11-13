import {describe,it,expect,vi} from "vitest";
import {listOrganizationMembers,updateOrganizationMember,MemberManagementError} from "../src/postgres-members-repository.js";
const org="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", actor="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", member="cccccccc-cccc-4ccc-8ccc-cccccccccccc", target="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
function mockPool(options:{memberUser?:string;count?:string}={}){
 const calls:string[]=[];
 const client={query:vi.fn(async(sql:string)=>{
  calls.push(sql);
  if(sql.includes('SELECT m.id::text'))return {rows:[{membershipId:member,userId:target,email:"user@example.test",fullName:"Utente",role:"analyst",status:"active",joinedAt:"2026-01-01T00:00:00Z"}],rowCount:1};
  if(sql.includes('SELECT user_id::text'))return {rows:[{userId:options.memberUser??target,role:"admin",status:"active"}],rowCount:1};
  if(sql.includes('COUNT(*)::text'))return {rows:[{count:options.count??"2"}],rowCount:1};
  if(sql.includes('UPDATE memberships'))return {rows:[{userId:target,role:"viewer",status:"suspended",joinedAt:"2026-01-01T00:00:00Z"}],rowCount:1};
  if(sql.includes('SELECT email,full_name'))return {rows:[{email:"user@example.test",fullName:"Utente"}],rowCount:1};
  return {rows:[],rowCount:1};
 }),release:vi.fn()};
 return {pool:{connect:vi.fn(async()=>client)} as never,calls,client};
}
describe("Gestione membri organizzazione",()=>{
 it("elenca membri filtrando per organizzazione",async()=>{
  const {pool,calls}=mockPool();
  const result=await listOrganizationMembers(pool,org);
  expect(result).toHaveLength(1);
  expect(calls.some(sql=>sql.includes("m.organization_id=$1::uuid"))).toBe(true);
 });
 it("impedisce l'auto-modifica e la rimozione dell'ultimo amministratore",async()=>{
  const self=mockPool({memberUser:actor});
  await expect(updateOrganizationMember(self.pool,org,member,actor,{role:"viewer"})).rejects.toMatchObject({status:409});
  const last=mockPool({count:"1"});
  await expect(updateOrganizationMember(last.pool,org,member,actor,{status:"suspended"})).rejects.toMatchObject({status:409});
 });
 it("aggiorna ruolo/stato e registra l'operazione nell'audit",async()=>{
  const {pool,calls}=mockPool();
  const result=await updateOrganizationMember(pool,org,member,actor,{role:"viewer",status:"suspended"});
  expect(result).toMatchObject({membershipId:member,userId:target,email:"user@example.test",role:"viewer",status:"suspended"});
  expect(calls.some(sql=>sql.includes("INSERT INTO audit_logs"))).toBe(true);
 });
 it("valida ruolo e identificativi prima di aprire la connessione",async()=>{
  const connect=vi.fn();
  await expect(updateOrganizationMember({connect} as never,org,member,actor,{role:"owner"})).rejects.toBeInstanceOf(MemberManagementError);
  expect(connect).not.toHaveBeenCalled();
 });
});
