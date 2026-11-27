# Operation and verification notes

## Proxy troubleshooting

Docker daemon proxy configuration controls image pulls, not dependency downloads
inside Dockerfile `RUN` steps. Use Docker client build proxy settings or explicit
build arguments. Do not place proxy credentials in Dockerfiles, build `ENV`, Git
or screenshots. Standard Docker proxy build arguments are not declared as `ARG`
in these Dockerfiles.

For a Linux host with a proxy listening only on host loopback, an optional local
Compose override can give **build steps only** host networking:

```yaml
# Save outside the repository, for example /tmp/adrobot-build-proxy.yaml.
services:
  backend:
    build: &proxied_build
      network: host
      args:
        HTTP_PROXY: ${HTTP_PROXY:-}
        HTTPS_PROXY: ${HTTPS_PROXY:-}
        NO_PROXY: ${NO_PROXY:-}
  frontend:
    build: *proxied_build
```

```bash
docker compose -f compose.yaml -f /tmp/adrobot-build-proxy.yaml build
docker compose up -d --wait --wait-timeout 180
```

This does not change runtime network isolation or publish backend/DB ports. Runtime
Keitaro access needs a proxy reachable from the backend container, if required by
your network. A VPN or daemon restart can stop existing containers; inspect
`docker ps -a` and restart the intended stack without deleting its volume.

## Existing editor data after upgrading

No new database migration is required by the engineering review; head remains
`0002_editor_state`. Remote snapshots now include routing fields that older code
silently dropped. For snapshots saved by that older code, a conservative
`upstream_conflict` may occur on the first Push. Review the draft, then explicitly
Fetch (with discard confirmation if needed) and reapply intended edits. The app
never silently replaces a saved draft to upgrade a snapshot.

## Manual live acceptance

Only an authorized operator should perform this sequence against an external
tracker. Use a newly created campaign with `test_panesh_` prefix; take IDs/revisions
from responses, not historical examples. Do not change the shared offer catalog.

1. Create through the UI. Verify configured domain/group/source, position rotation,
   country redirect to Google and fallback offer at 100% in Keitaro.
2. Add two offers: verify 50/50 and then 34/33/33 by ID. Before Push, Keitaro remains
   unchanged. Pin, remove another offer and Bring Back; verify fixed shares and
   removed rows at 0% without a pin.
3. Enter 60%, verify 20/20 for the other free rows. Try invalid input, Enter/Escape,
   active zero, Pin/Unpin, pinned-share editing and last-offer rejection. Reload
   and restart backend: drafts survive. Cancel restores confirmed pins/shares.
4. Push and compare Keitaro. Confirm pin-only Push sends no PUT, and pin-only Cancel
   restores pins. Publish a removal, reload, then restore its retained row.
5. Make a deliberate external change in this same owned test campaign. Push must
   conflict without erasing the draft. Fetch requires current-revision discard
   confirmation. Cancel the dialog and verify the draft remains. Repeat with two
   tabs to exercise stale revisions. Check View in KT and deep-link F5.
6. Use local mocks for invalid totals, lost responses and network failures rather
   than damaging the live stand. A tracker that normalizes its own shares cannot
   reproduce every invalid-total case. Delete test campaigns only with separate
   authorization.

## Journal and failure handling

`campaign_operations` records `pending`, `success`, `failed`, `unknown`,
`rolled_back` or `cleanup_failed`. A failure to finalize the journal leaves pending;
application logs record operation ID/outcome without key, response body or name.
After an uncertain creation, inspect Keitaro before another POST. After an uncertain
publication, reload editor state and inspect/retry Push explicitly. Successful
remote publication and local transaction commit are separate events.

Before manual Git commit, review `git status --short`, `git diff --check` and the
diff itself. Confirm private context and `.env` remain ignored. No commit or push
is performed by the review workflow.
