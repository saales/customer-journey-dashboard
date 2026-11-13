-- Allow administrators to update only the organization display name.
GRANT UPDATE (name, updated_at) ON TABLE organizations TO percorso_app;
