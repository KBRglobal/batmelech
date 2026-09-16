# Bat Melech e2e — web only for now. The run brings up its own throwaway
# Postgres and a local server; it never touches the production database.
E2E_WEB_PORT=4790
E2E_DB_CONTAINER=bm-e2e-pg
E2E_DB_PORT=55432
E2E_DB_URL="postgresql://postgres:e2e@127.0.0.1:55432/batmelech"
E2E_UP="docker run -d --name \$E2E_DB_CONTAINER -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=batmelech -p \$E2E_DB_PORT:5432 postgres:18"
E2E_DOWN="docker rm -f \$E2E_DB_CONTAINER"
E2E_SERVER="DATABASE_URL=\$E2E_DB_URL BM_USER=e2e_owner BM_PASS=e2e_pass_r0 BM_SESSION_SECRET=e2e_session_secret_that_is_long_enough_0123 BM_STATE_COMMAND_SECRET=e2e_command_secret_that_is_long_enough_0123 BM_BUSINESS_CLOCK=off PORT=\$E2E_WEB_PORT node server.js"
