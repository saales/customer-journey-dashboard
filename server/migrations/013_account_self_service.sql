-- Allow self-service account profile and password updates only on approved columns.
GRANT UPDATE (full_name, updated_at) ON TABLE users TO percorso_app;
