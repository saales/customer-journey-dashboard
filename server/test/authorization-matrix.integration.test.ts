import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { createHttpTestEnvironment,integrationDatabaseUrl,type HttpTestEnvironment,type Role } from "./helpers/http-test-environment.js";

const dbUrl=integrationDatabaseUrl();
let env:HttpTestEnvironment;
beforeAll(async()=>{if(dbUrl)env=await createHttpTestEnvironment();},60_000);
afterAll(async()=>{await env?.close();});

const cases:Array<{method:string;path:string;allowed:Role[];body?:unknown}>= [
  {method:"GET",path:"/api/meta",allowed:["admin","editor","analyst","viewer"]},
  {method:"GET",path:"/api/customers",allowed:["admin","editor","analyst","viewer"]},
  {method:"GET",path:"/api/funnel-stages",allowed:["admin","editor","analyst","viewer"]},
  {method:"GET",path:"/api/export/organization.json",allowed:["admin","editor","analyst"]},
  {method:"GET",path:"/api/audit",allowed:["admin"]},
  {method:"GET",path:"/api/members",allowed:["admin"]},
  {method:"GET",path:"/api/invitations",allowed:["admin"]},
  {method:"POST",path:"/api/import",allowed:["admin","editor"],body:{rows:[]}},
  {method:"POST",path:"/api/funnel-stages",allowed:["admin","editor"],body:{}},
];

describe.skipIf(!dbUrl)("Matrice autorizzazioni HTTP per ruolo",()=>{
  it("applica la matrice admin/editor/analyst/viewer sulle route protette",async()=>{
    for(const role of ["admin","editor","analyst","viewer"] as const){
      const token=env.tenants.A.users[role].token;
      for(const route of cases){
        const response=await env.request(route.method,route.path,{token,body:route.body});
        if(route.allowed.includes(role)){
          expect(response.status,role+" "+route.method+" "+route.path).not.toBe(401);
          expect(response.status,role+" "+route.method+" "+route.path).not.toBe(403);
          expect(response.status,role+" "+route.method+" "+route.path).toBeLessThan(500);
        }else{
          expect(response.status,role+" "+route.method+" "+route.path).toBe(403);
        }
      }
    }
  });

  it("impedisce a un amministratore di un tenant di modificare o cancellare clienti di un altro tenant",async()=>{
    const foreignCustomerId=env.tenants.B.customerIds[0]!;
    const token=env.tenants.A.users.admin.token;
    const update=await env.request("PUT",`/api/customers/${foreignCustomerId}`,{token,body:{channel:"Direct"}});
    const deletion=await env.request("DELETE",`/api/customers/${foreignCustomerId}`,{token});
    expect(update.status).toBe(404);
    expect(deletion.status).toBe(404);
    const sentinel=await env.adminPool.query<{count:string}>(
      "SELECT COUNT(*)::text AS count FROM customers WHERE organization_id=$1 AND id=$2::bigint",
      [env.tenants.B.id,foreignCustomerId],
    );
    expect(sentinel.rows[0]?.count).toBe("1");
  });

  it("non espone i dati del tenant B nell'export del tenant A",async()=>{
    const response=await env.request("GET","/api/export/organization.json",{token:env.tenants.A.users.admin.token});
    expect(response.status).toBe(200);
    expect(response.text).not.toContain("only-b-2");
    expect(response.text).not.toContain("tenant-b");
  });
});
