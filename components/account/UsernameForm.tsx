"use client";

import { useState, useTransition } from "react";
import { setUsername } from "@/app/actions/account";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";

export function UsernameForm({ initial }: { initial: string }) {
  const { showToast } = useToast();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await setUsername({ username: value });
          if (!result.ok) {
            setError(result.fieldErrors?.username?.[0] ?? result.error);
            return;
          }
          setError(undefined);
          setValue(result.data?.username ?? "");
          showToast(result.data?.username ? "Username saved." : "Username removed.", "success");
        });
      }}
    >
      <Field label="Username" optional helperText="Lowercase letters, numbers, dots, dashes and underscores (3-30). Sign in with it instead of your email." error={error}>
        <Input value={value} onChange={(e) => setValue(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={30} />
      </Field>
      <Button type="submit" variant="primary" loading={pending} className="self-start">Save username</Button>
    </form>
  );
}
