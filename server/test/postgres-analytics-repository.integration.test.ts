import { afterAll,describe,expect,it } from "vitest";
import { Pool } from "pg";
import {getPostgresChannels,getPostgresMeta,getPostgresSummary,getPostgresTimeseries} from "../src/postgres-analytics-repository.js";
const cs=process.env.DATABASE_URL;
const pool=cs?new Pool({connectionString:cs,max:1,connectionTimeoutMillis:5000}):null;
afterAll(async()=>{await pool?.end();});
describe("Analisi PostgreSQL tenant-scoped",()=>{
 it.skipIf(!pool)("calcola KPI, funnel, canali e andamento senza leggere altri tenant",async()=>{
  const a="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",b="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const c=await pool!.connect();
  try{
   await c.query(`CREATE TEMP TABLE customers(id BIGINT PRIMARY KEY,organization_id UUID NOT NULL,channel TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL) ON COMMIT PRESERVE ROWS`);
   await c.query(`CREATE TEMP TABLE events(id BIGINT PRIMARY KEY,organization_id UUID NOT NULL,customer_id BIGINT NOT NULL,stage_id TEXT NOT NULL,occurred_at TIMESTAMPTZ NOT NULL) ON COMMIT PRESERVE ROWS`);
   await c.query(`CREATE TEMP TABLE funnel_stages(organization_id UUID NOT NULL,id TEXT NOT NULL,label TEXT NOT NULL,position INTEGER NOT NULL,is_active BOOLEAN NOT NULL) ON COMMIT PRESERVE ROWS`);
   await c.query(`INSERT INTO customers VALUES (1,$1,'Organico','2026-01-01T00:00:00Z'),(2,$1,'Social','2026-01-15T00:00:00Z'),(3,$2,'Advertising','2026-01-10T00:00:00Z')`,[a,b]);
   await c.query(`INSERT INTO events VALUES
    (1,$1,1,'visit','2026-01-01T00:00:00Z'),(2,$1,1,'lead','2026-01-02T00:00:00Z'),(3,$1,1,'customer','2026-01-11T00:00:00Z'),
    (4,$1,2,'visit','2026-01-15T00:00:00Z'),(5,$1,2,'lead','2026-01-16T00:00:00Z'),
    (6,$2,3,'visit','2026-01-10T00:00:00Z'),(7,$2,3,'customer','2026-01-12T00:00:00Z')`,[a,b]);
   await c.query(`INSERT INTO funnel_stages VALUES
    ($1,'visit','Visita',0,true),($1,'lead','Lead',1,true),($1,'customer','Cliente',2,true),
    ($2,'visit','Visita',0,true),($2,'lead','Lead',1,true),($2,'customer','Cliente',2,true)`,[a,b]);
  }finally{c.release();}
  const f={from:"2026-01-01",to:"2026-01-31"};
  const summary=await getPostgresSummary(pool!,a,f);
  expect(summary.kpis).toEqual({visits:2,leads:2,customers:1,conversionRate:50,avgDaysToCustomer:10});
  expect(summary.funnel.map(x=>[x.stage,x.count])).toEqual([["visit",2],["lead",2],["customer",1]]);
  expect(await getPostgresChannels(pool!,a,{...f,channel:"Social"})).toEqual([
   {channel:"Organico",visits:1,leads:1,customers:1,visitToLead:100,visitToCustomer:100},
   {channel:"Social",visits:1,leads:1,customers:0,visitToLead:100,visitToCustomer:0}
  ]);
  expect(await getPostgresTimeseries(pool!,a,f)).toEqual([{month:"2026-01",visits:2,customers:1,conversion:50}]);
  expect(await getPostgresMeta(pool!,a)).toEqual({minDate:"2026-01-01",maxDate:"2026-01-15",channels:["Organico","Social","Email","Advertising","Referral"]});
 });
 it("rifiuta tenant e filtri non validi prima della connessione",async()=>{
  const noConnect={connect:()=>{throw new Error("non deve connettersi");}};
  await expect(getPostgresSummary(noConnect,"bad",{from:"2026-01-01",to:"2026-01-02"})).rejects.toThrow("Identificativo organizzazione");
  await expect(getPostgresSummary(noConnect,"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",{from:"2026-02-02",to:"2026-01-01"})).rejects.toThrow("Intervallo date");
  await expect(getPostgresSummary(noConnect,"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",{from:"2026-01-01",to:"2026-01-02",channel:"fake"})).rejects.toThrow("Canale non valido");
 });
});
