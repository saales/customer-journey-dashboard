import {describe,it,expect,vi} from "vitest";
import {listOrganizationMembers,updateOrganizationMember,MemberManagementError} from "../src/postgres-members-repository.js";
const org="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", actor="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", member="cccccccc-cccc-4ccc-8ccc-cccccccccccc", target="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
function poolFor(responses:Array<{rows?:unknown[];rowCount?:number}>){
 const calls:string[]=[];const client={query:vi.fn(async(sql:string)=>{calls.push(sql);return responses.shift()??{rows:[],rowCount:1};}),release:vi.fn()};
 return {pool:{connect:vi.fn(async()=>client)} as never,calls,client};
}
describe("Gestione membri organizzazione",()=>{
 it("elenca membri con filtro tenant",async()=>{
  const data={membershipId:member,userId:target,email:"user@example.test",fullName:"Utente",role:"analyst",status:"active",joinedAt:"2026-01-01T00:00:00Z"};
  const {pool,calls}=poolFor([{rows:[]},{rows:[data]}]);
  await expect(listOrganizationMembers(pool,org)).resolves.toEqual([data]);
  expect(calls.some(sql=>sql.includes("m.organization_id=$1::uuid"))).toBe(true);
 });
 it("impedisce auto-modifica e rimozione dell'ultimo admin",async()=>{
  const self=poolFor([{rows:[]},{rows:[{userId:actor,role:"admin",status:"active"}]}]);
  await expect(updateOrganizationMember(self.pool,org,member,actor,{role:"viewer"})).rejects.toMatchObject({status:409});
  const last=poolFor([{rows:[]},{rows:[{userId:target,role:"admin",status:"active"}]},{rows:[{count:"1"}]}]);
  await expect(updateOrganizationMember(last.pool,org,member,actor,{status:"suspended"})).rejects.toMatchObject({status:409});
 });
 it("valida ruolo e identificativi prima della connessione",async()=>{
  const connect=vi.fn();
  await expect(updateOrganizationMember({connect} as never,org,member,actor,{role:"owner"})).rejects.toBeInstanceOf(MemberManagementError);
  expect(connect).not.toHaveBeenCalled();
 });
});
