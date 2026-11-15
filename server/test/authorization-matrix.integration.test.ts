import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { createHttpTestEnvironment,integrationDatabaseUrl,type HttpTestEnvironment,type Role } from "./helpers/http-test-environment.js";

const dbUrl=integrationDatabaseUrl();
let env:HttpTestEnvironment;
beforeAll(async()=>{if(dbUrl)env=await createHttpTestEnvironment();},60_000);
afterAll(async()=>{await env?.close();});

const cases:Array<{method:string;path:string;allowed:Role[];body?:unknown}>= [
  {method:"GET",path:"/api/meta",allowed:["admin","editor","analyst","viewer"]},
  {method:"GET",path:"/api/summary",allowed:["admin","editor","analyst","viewer"]},
  {method:"GET",path:"/api/channels",allowed:["admin","editor","analyst","viewer"]},
  {method:"GET",path:"/api/timeseries",allowed:["admin","editor","analyst","viewer"]},
  {method:"GET",path:"/api/segments",allowed:["admin","editor","analyst","viewer"]},
  {method:"GET",path:"/api/segments/customers",allowed:["admin","editor","analyst","viewer"]},
  {method:"GET",path:"/api/export/customers.csv",allowed:["admin","editor","analyst"]},
  {method:"GET",path:"/api/account",allowed:["admin","editor","analyst","viewer"]},
  {method:"GET",path:"/api/account/sessions",allowed:["admin","editor","analyst","viewer"]},
  {method:"PATCH",path:"/api/account",allowed:["admin","editor","analyst","viewer"],body:{fullName:"Test User"}},
  {method:"GET",path:"/api/organization",allowed:["admin"]},
  {method:"PATCH",path:"/api/organization",allowed:["admin"],body:{}},
  {method:"PATCH",path:"/api/members/00000000-0000-4000-8000-000000000000",allowed:["admin"],body:{}},
  {method:"POST",path:"/api/invitations",allowed:["admin"],body:{}},
  {method:"POST",path:"/api/invitations/00000000-0000-4000-8000-000000000000/revoke",allowed:["admin"]},
  {method:"POST",path:"/api/customers",allowed:["admin","editor"],body:{}},
  {method:"PUT",path:"/api/funnel-stages/reorder",allowed:["admin","editor"],body:{}},
  {method:"PUT",path:"/api/funnel-stages/not-a-real-stage",allowed:["admin","editor"],body:{}},
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
    const update=await env.request("PUT",`/api/customers/${foreignCustomerId}`,{token,body:{channel:"Email",createdAt:"2026-01-10",events:[]}});
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

  it("un amministratore non può modificare la membership di un altro tenant",async()=>{
    const target=env.tenants.B.users.viewer.membershipId;
    const before=await env.adminPool.query<{role:string;status:string;organizationId:string}>(
      "SELECT role,status,organization_id::text AS \"organizationId\" FROM memberships WHERE id=$1",[target],
    );
    const response=await env.request("PATCH",`/api/members/${target}`,{
      token:env.tenants.A.users.admin.token,body:{role:"analyst",status:"suspended"},
    });
    expect(response.status).toBe(404);
    const after=await env.adminPool.query<{role:string;status:string;organizationId:string}>(
      "SELECT role,status,organization_id::text AS \"organizationId\" FROM memberships WHERE id=$1",[target],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("un tenant non può elencare né revocare gli inviti di un altro tenant",async()=>{
    const email="cross-tenant-invitation@example.test";
    const created=await env.request<{invitation:{id:string}}> ("POST","/api/invitations",{
      token:env.tenants.A.users.admin.token,body:{email,role:"editor"},
    });
    expect(created.status).toBe(201);
    const invitationId=created.body.invitation.id;
    const listB=await env.request("GET","/api/invitations",{token:env.tenants.B.users.admin.token});
    expect(listB.status).toBe(200);
    expect(listB.text).not.toContain(email);
    const revokeB=await env.request("POST",`/api/invitations/${invitationId}/revoke`,{
      token:env.tenants.B.users.admin.token,
    });
    expect(revokeB.status).toBe(404);
    const state=await env.adminPool.query<{revokedAt:Date|null}>(
      "SELECT revoked_at AS \"revokedAt\" FROM invitations WHERE id=$1",[invitationId],
    );
    expect(state.rows[0]?.revokedAt).toBeNull();
    const revokeA=await env.request("POST",`/api/invitations/${invitationId}/revoke`,{
      token:env.tenants.A.users.admin.token,
    });
    expect(revokeA.status).toBe(204);
  });

  it("un'importazione con fase esistente solo nel tenant B è rifiutata senza scritture",async()=>{
    const tenantB=env.tenants.B,tenantA=env.tenants.A;
    const position=await env.adminPool.query<{next:number}>(
      "SELECT COALESCE(MAX(position),-1)::int+1 AS next FROM funnel_stages WHERE organization_id=$1",[tenantB.id],
    );
    await env.adminPool.query(
      "INSERT INTO funnel_stages(organization_id,id,label,position,is_active,is_system) VALUES($1,'private_b_stage','Fase privata B',$2,TRUE,FALSE)",
      [tenantB.id,position.rows[0]!.next],
    );
    const externalId="invalid-cross-tenant-stage-probe";
    const response=await env.request("POST","/api/import",{
      token:tenantA.users.admin.token,
      body:{fileName:"foreign-stage.csv",rows:[{
        externalId,channel:"Email",createdAt:"2026-01-15",stage:"private_b_stage",occurredAt:"2026-01-15",
      }]},
    });
    expect(response.status).toBe(400);
    const persisted=await env.adminPool.query(
      "SELECT organization_id::text AS org FROM customers WHERE external_id=$1",[externalId],
    );
    expect(persisted.rowCount).toBe(0);
    expect((await env.adminPool.query("SELECT COUNT(*)::int n FROM import_batches WHERE organization_id=$1 AND file_name='foreign-stage.csv'",[tenantA.id])).rows[0]?.n).toBe(0);
  });

  it("isola letture di clienti, funnel, membri e audit e ignora l'organizzazione fornita dal client nell'import",async()=>{
    const tenantB=env.tenants.B;
    const tenantA=env.tenants.A;
    const position=await env.adminPool.query<{next:number}>(
      "SELECT COALESCE(MAX(position),-1)::int+1 AS next FROM funnel_stages WHERE organization_id=$1",
      [tenantB.id],
    );
    await env.adminPool.query(
      "INSERT INTO funnel_stages(organization_id,id,label,position,is_active,is_system) VALUES($1,'tenant_b_only','Solo Tenant B',$2,TRUE,FALSE)",
      [tenantB.id,position.rows[0]!.next],
    );
    await env.adminPool.query(
      "INSERT INTO audit_logs(organization_id,actor_user_id,action,resource_type,resource_id,details) VALUES($1,$2,'customer.created','customer','tenant-b-audit-sentinel',$3::jsonb)",
      [tenantB.id,tenantB.users.admin.id,JSON.stringify({marker:"tenant-b-audit-sentinel"})],
    );

    const customers=await env.request("GET","/api/customers",{token:tenantA.users.admin.token});
    const stages=await env.request("GET","/api/funnel-stages",{token:tenantA.users.admin.token});
    const members=await env.request("GET","/api/members",{token:tenantA.users.admin.token});
    const audit=await env.request("GET","/api/audit",{token:tenantA.users.admin.token});
    expect(customers.text).not.toContain("only-b-2");
    expect(stages.text).not.toContain("Solo Tenant B");
    expect(members.text).not.toContain("admin.b@example.test");
    expect(audit.text).not.toContain("tenant-b-audit-sentinel");

    const imported=await env.request("POST","/api/import",{
      token:tenantA.users.admin.token,
      body:{
        fileName:"tenant-b-target.csv",
        organizationId:tenantB.id,
        rows:[{externalId:"cross-org-import-probe",channel:"Email",createdAt:"2026-01-15",stage:"visit",occurredAt:"2026-01-15"}],
      },
    });
    expect(imported.status).toBe(201);
    const counts=await env.adminPool.query<{organizationId:string;count:string}>(
      "SELECT organization_id::text AS \"organizationId\",COUNT(*)::text AS count FROM customers WHERE external_id='cross-org-import-probe' GROUP BY organization_id",
    );
    expect(counts.rows).toEqual([{organizationId:tenantA.id,count:"1"}]);
  });
});
