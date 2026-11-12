/** Instance-wide default limits and module defaults (empty means unlimited / all modules on). */
export const LIMIT_SETTING_KEYS = {
  "limits.maxMembers": { secret: false, env: "LIMITS_MAX_MEMBERS" },
  "limits.maxGuests": { secret: false, env: "LIMITS_MAX_GUESTS" },
  "limits.maxProjects": { secret: false, env: "LIMITS_MAX_PROJECTS" },
  "limits.maxStorageBytes": { secret: false, env: "LIMITS_MAX_STORAGE_BYTES" },
  "limits.maxFileBytes": { secret: false, env: "LIMITS_MAX_FILE_BYTES" },
  "limits.maxApiTokens": { secret: false, env: "LIMITS_MAX_API_TOKENS" },
  "limits.maxWebhooks": { secret: false, env: "LIMITS_MAX_WEBHOOKS" },
  "limits.assistantMonthlyTokens": { secret: false, env: "LIMITS_ASSISTANT_MONTHLY_TOKENS" },
  "limits.monthlyEmailCap": { secret: false, env: "LIMITS_MONTHLY_EMAIL_CAP" },
  "limits.maxWorkspacesPerOwner": { secret: false, env: "LIMITS_MAX_WORKSPACES_PER_OWNER" },
  "modules.disabledByDefault": { secret: false, env: "MODULES_DISABLED_BY_DEFAULT" },
} as const;
