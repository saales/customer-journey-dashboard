import {describe,expect,it,vi} from "vitest";
import {bootstrapInitialPostgresOrganization,BootstrapError} from "../src/postgres-bootstrap.js";

const valid={
 expectedDatabase:"percorso_test",organizationName:"Organizzazione Demo",
 organizationSlug:"organizzazione-demo",adminEmail:"admin@example.test",
 adminFullName:"Amministratore",adminPassword:"UnaPasswordMoltoSicura-2026",
};
function mockPool(existing={organizations:"0",users:"0"}){
 const calls:{sql:string;values?:unknown[]}[]=[];
 const client={
  query:vi.fn(async(sql:string,values?:unknown[])=>{
   calls.push({sql,values});
   if(sql.includes("current_database"))return {rows:[{database:"percorso_test"}],rowCount:1};
   if(sql.includes("COUNT(*) FROM organizations"))return {rows:[existing],rowCount:1};
   if(sql.includes("INSERT INTO organizations"))return {rows:[{id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}],rowCount:1};
   if(sql.includes("INSERT INTO users"))return {rows:[{id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}],rowCount:1};
   return {rows:[],rowCount:1};
  }),
  release:vi.fn(),
 };
 return {pool:{connect:vi.fn(async()=>client)} as never,client,calls};
}
describe("bootstrap iniziale PostgreSQL",()=>{
 it("crea in un'unica transazione organizzazione, admin, membership, funnel e audit",async()=>{
  const {pool,client,calls}=mockPool();
  const result=await bootstrapInitialPostgresOrganization(pool,valid);
  expect(result).toMatchObject({database:"percorso_test",organizationSlug:"organizzazione-demo",adminEmail:"admin@example.test",initialStages:5});
  expect(calls[0]?.sql).toBe("BEGIN");
  expect(calls.some(c=>c.sql.includes("INSERT INTO memberships"))).toBe(true);
  expect(calls.filter(c=>c.sql.includes("INSERT INTO funnel_stages"))).toHaveLength(5);
  expect(calls.some(c=>c.sql.includes("INSERT INTO audit_logs"))).toBe(true);
  expect(calls.at(-1)?.sql).toBe("COMMIT");
  const userInsert=calls.find(c=>c.sql.includes("INSERT INTO users"));
  expect(userInsert?.values?.[1]).not.toBe(valid.adminPassword);
  expect(client.release).toHaveBeenCalledWith(false);
 });
 it("rifiuta database errato o già popolato e annulla la transazione",async()=>{
  const wrong=mockPool();
  await expect(bootstrapInitialPostgresOrganization(wrong.pool,{...valid,expectedDatabase:"produzione"})).rejects.toThrow("non corrisponde");
  expect(wrong.calls.at(-1)?.sql).toBe("ROLLBACK");
  const occupied=mockPool({organizations:"1",users:"1"});
  await expect(bootstrapInitialPostgresOrganization(occupied.pool,valid)).rejects.toThrow("database non è vuoto");
  expect(occupied.calls.at(-1)?.sql).toBe("ROLLBACK");
  expect(occupied.calls.some(c=>c.sql.includes("INSERT INTO organizations"))).toBe(false);
 });
 it("valida gli input prima di aprire connessioni",async()=>{
  const connect=vi.fn();
  await expect(bootstrapInitialPostgresOrganization({connect} as never,{...valid,adminPassword:"short"})).rejects.toBeInstanceOf(BootstrapError);
  await expect(bootstrapInitialPostgresOrganization({connect} as never,{...valid,organizationSlug:"Invalid Slug"})).rejects.toBeInstanceOf(BootstrapError);
  expect(connect).not.toHaveBeenCalled();
 });
});
