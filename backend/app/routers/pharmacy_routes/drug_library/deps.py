"""deps — shared role dependencies for the drug-library route modules."""
from app.middleware.auth import require_roles

# Canonical role dependencies — preserve the exact roles each endpoint allowed.
require_pharmacist = require_roles("pharmacist", "admin")
require_admin = require_roles("admin")
