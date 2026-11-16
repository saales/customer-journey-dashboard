import { afterAll,describe,expect,it } from "vitest";
import { Pool } from "pg";
import {getPostgresSegmentCustomers,getPostgresSegments} from "../src/postgres-segmentation-repository.js";
const cs=process.env.DATABASE_URL;
const pool=cs?new Pool({connectionString:cs,max:1,connectionTimeoutMillis:5000}):null;
afterAll(async()=>{await pool?.end();});
describe("Segmentazione PostgreSQL tenant-scoped",()=>{
 it.skipIf(!pool)("classifica fasi attive/disattivate e limita i clienti al tenant",async()=>{
  const a="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",b="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const c=await pool!.connect();
  try{
   await c.query("DROP TABLE IF EXISTS pg_temp.events");
   await c.query("DROP TABLE IF EXISTS pg_temp.customers");
   await c.query("DROP TABLE IF EXISTS pg_temp.funnel_stages");
   await c.query(`CREATE TEMP TABLE customers(id BIGINT PRIMARY KEY,organization_id UUID NOT NULL,channel TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL) ON COMMIT PRESERVE ROWS`);
   await c.query(`CREATE TEMP TABLE events(id BIGINT PRIMARY KEY,organization_id UUID NOT NULL,customer_id BIGINT NOT NULL,stage_id TEXT NOT NULL,occurred_at TIMESTAMPTZ NOT NULL) ON COMMIT PRESERVE ROWS`);
   await c.query(`CREATE TEMP TABLE funnel_stages(organization_id UUID NOT NULL,id TEXT NOT NULL,label TEXT NOT NULL,position INTEGER NOT NULL,is_active BOOLEAN NOT NULL) ON COMMIT PRESERVE ROWS`);
   await c.query(`INSERT INTO customers VALUES
    (1,$1,'Organico','2026-01-01T00:00:00Z'),(2,$1,'Social','2026-01-02T00:00:00Z'),
    (3,$2,'Advertising','2026-01-03T00:00:00Z')`,[a,b]);
   await c.query(`INSERT INTO funnel_stages VALUES
    ($1,'visit','Visita',0,true),($1,'lead','Contatto',1,false),($1,'customer','Cliente',2,true),
    ($2,'visit','Visita',0,true)`,[a,b]);
   await c.query(`INSERT INTO events VALUES
    (1,$1,1,'visit','2026-01-01T00:00:00Z'),(2,$1,1,'lead','2026-01-02T00:00:00Z'),
    (3,$1,2,'visit','2026-01-02T00:00:00Z'),(4,$1,2,'customer','2026-01-04T00:00:00Z'),
    (5,$2,3,'visit','2026-01-03T00:00:00Z')`,[a,b]);
  }finally{c.release();}
  const f={from:"2026-01-01",to:"2026-01-31"};
  const segments=await getPostgresSegments(pool!,a,f);
  expect(segments.totalCustomers).toBe(2);
  expect(segments.stages).toEqual([
   {id:"customer",label:"Cliente",customers:1,share:50,conversionRate:100},
   {id:"inactive",label:"Fase disattivata",customers:1,share:50,conversionRate:0},
  ]);
  expect(segments.channels.map(x=>x.id).sort()).toEqual(["Organico","Social"]);
  const inactive=await getPostgresSegmentCustomers(pool!,a,f,"stage","inactive");
  expect(inactive.map(x=>x.id)).toEqual(["1"]);
  const combined=await getPostgresSegmentCustomers(pool!,a,f,"combination","Organico~inactive");
  expect(combined.map(x=>x.id)).toEqual(["1"]);
  expect((await getPostgresSegments(pool!,b,f)).totalCustomers).toBe(1);
 });
 it("rifiuta filtri e segmenti malformati prima della connessione",async()=>{
  const noConnect={connect:()=>{throw new Error("non deve connettersi");}};
  await expect(getPostgresSegments(noConnect,"bad",{from:"2026-01-01",to:"2026-01-02"})).rejects.toThrow("Identificativo organizzazione");
  await expect(getPostgresSegmentCustomers(noConnect,"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",{from:"2026-01-01",to:"2026-01-02"} as never,"bad" as never,"x")).rejects.toThrow("Dimensione del segmento");
 });
});
