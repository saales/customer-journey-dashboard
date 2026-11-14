import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { hashPassword } from "../src/password-hashing.js";
import { getPostgresAccountProfile, updatePostgresAccountName, changePostgresAccountPassword, PostgresAccountError } from "../src/postgres-account-repository.js";

const profile={userId:"11111111-1111-4111-8111-111111111111",email:"user@example.test",fullName:"Test User",role:"admin" as const};
const org="22222222-2222-4222-8222-222222222222";

describe("account self-service PostgreSQL",()=>{
  it("recupera profilo e ruolo nella sola organizzazione della sessione",async()=>{
    const query=vi.fn(async(sql:string)=>sql.includes("FROM users u JOIN memberships")
      ?{rows:[profile],rowCount:1}:{rows:[],rowCount:0});
    const client={query,release:vi.fn()} as unknown as PoolClient;
    const pool={connect:vi.fn(async()=>client)};
    await expect(getPostgresAccountProfile(pool,org,profile.userId)).resolves.toEqual(profile);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("m.organization_id=$2::uuid"),[profile.userId,org]);
  });

  it("rifiuta un nome vuoto prima di aprire la connessione",async()=>{
    const pool={connect:vi.fn()};
    await expect(updatePostgresAccountName(pool,org,profile.userId," ")).rejects.toBeInstanceOf(PostgresAccountError);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("aggiorna il nome e registra l'audit nella transazione tenant",async()=>{
    const statements:string[]=[];
    const query=vi.fn(async(sql:string)=>{
      statements.push(sql);
      if(sql.includes("SELECT 1 FROM memberships"))return{rows:[{}],rowCount:1};
      if(sql.includes("UPDATE users SET full_name"))return{rows:[],rowCount:1};
      if(sql.includes("SELECT u.id::text"))return{rows:[{...profile,fullName:"Updated"}],rowCount:1};
      return{rows:[],rowCount:1};
    });
    const client={query,release:vi.fn()} as unknown as PoolClient;
    const pool={connect:vi.fn(async()=>client)};
    const result=await updatePostgresAccountName(pool,org,profile.userId,"Updated");
    expect(result.fullName).toBe("Updated");
    expect(statements.some(sql=>sql.includes("INSERT INTO audit_logs"))).toBe(true);
    expect(statements.at(-1)).toBe("COMMIT");
  });

  it("rifiuta la password attuale errata senza aggiornare credenziali o sessioni",async()=>{
    const currentHash=await hashPassword("Correct-current-password-2026!");
    const statements:string[]=[];
    const query=vi.fn(async(sql:string)=>{
      statements.push(sql);
      if(sql.includes("SELECT 1 FROM memberships"))return{rows:[{}],rowCount:1};
      if(sql.includes("SELECT password_hash"))return{rows:[{passwordHash:currentHash}],rowCount:1};
      return{rows:[],rowCount:1};
    });
    const client={query,release:vi.fn()} as unknown as PoolClient;
    const pool={connect:vi.fn(async()=>client)};
    await expect(changePostgresAccountPassword(pool,org,profile.userId,"wrong-current-password","New-password-long-2026!"))
      .rejects.toMatchObject({status:401});
    expect(statements).toContain("ROLLBACK");
    expect(statements.some(sql=>sql.includes("UPDATE users SET password_hash"))).toBe(false);
    expect(statements.some(sql=>sql.includes("DELETE FROM sessions"))).toBe(false);
  });

  it("cambia password in modo atomico, revoca tutte le sessioni e registra l'audit",async()=>{
    const currentHash=await hashPassword("Correct-current-password-2026!");
    const statements:string[]=[];
    const query=vi.fn(async(sql:string)=>{
      statements.push(sql);
      if(sql.includes("SELECT 1 FROM memberships"))return{rows:[{}],rowCount:1};
      if(sql.includes("SELECT password_hash"))return{rows:[{passwordHash:currentHash}],rowCount:1};
      if(sql.includes("UPDATE users SET password_hash"))return{rows:[],rowCount:1};
      return{rows:[],rowCount:1};
    });
    const client={query,release:vi.fn()} as unknown as PoolClient;
    const pool={connect:vi.fn(async()=>client)};
    await expect(changePostgresAccountPassword(pool,org,profile.userId,"Correct-current-password-2026!","New-password-long-2026!")).resolves.toBeUndefined();
    expect(statements.some(sql=>sql.includes("FOR UPDATE"))).toBe(true);
    expect(statements.some(sql=>sql.includes("DELETE FROM sessions"))).toBe(true);
    expect(statements.some(sql=>sql.includes("INSERT INTO audit_logs"))).toBe(true);
    expect(statements.at(-1)).toBe("COMMIT");
  });

  it("valida le password prima di interrogare il database",async()=>{
    const pool={connect:vi.fn()};
    await expect(changePostgresAccountPassword(pool,org,profile.userId,"old","short")).rejects.toBeInstanceOf(PostgresAccountError);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
