# Space Works Workspace Helm chart

Helm chart for running Space Works Workspace on Kubernetes. Part of [Space Works Workspace](../../README.md); see also the [documentation index](../../docs/README.md).

Runs the application on Kubernetes: a Deployment (non-root, read-only root
filesystem), a Service, an optional Ingress, a pre-install/pre-upgrade
migration Job, worker and beat Deployments, a PodDisruptionBudget and an optional HPA.
PostgreSQL, Redis, object storage and SMTP are external managed services.

Full guide: [docs/DEPLOYMENT_KUBERNETES.md](../../docs/DEPLOYMENT_KUBERNETES.md).

```bash
kubectl create namespace sww
kubectl -n sww create secret generic sww-runtime --from-env-file=/secure/path/sww.env
helm upgrade --install sww charts/spaceworks-workspace --namespace sww \
  --set existingSecret=sww-runtime \
  --set image.tag=sha-<commit> --set migration.image.tag=sha-<commit> \
  --values /secure/path/values-production.yaml --wait --timeout 10m
```

| Value | Default | Purpose |
| --- | --- | --- |
| `existingSecret` | `""` | Secret with the runtime environment (required unless `secret.create`) |
| `secret.create` / `secret.data` | `false` / `{}` | Let the chart create that Secret (evaluation only) |
| `image.repository` / `image.tag` | GHCR app image / appVersion | Use immutable `sha-<commit>` tags |
| `migration.enabled` / `migration.image.*` | `true` / GHCR backend image | `prisma migrate deploy` hook before every rollout |
| `worker.enabled` / `worker.replicas` | `true` / `1` | BullMQ consumers from the backend image |
| `beat.enabled` | `true` | One replica reconciles registry schedules |
| `replicaCount`, `autoscaling.*`, `podDisruptionBudget.*` | 2, off, on | Scale. Several replicas need Redis for rate limits and realtime |
| `ingress.*` | off | Disable proxy buffering for `/api/realtime` (SSE) |

The chart runs the backend as the whole application. There is no frontend sidecar. A separate rendering frontend requires its own Deployment, gateway-only Secret and HTTPS origin; see docs/DEPLOYMENT_SPLIT.md.

Worker/beat use the runtime Secret, private health probes on 3460 and a 600-second termination grace period. Redis must persist data with noeviction. See [jobs operations](../../docs/areas/jobs-queue.md).
