"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestNewOrganisation, updateOrganisationRequest } from "@/app/actions/orgRequests";
import { useToast } from "@/components/feedback/ToastProvider";
import { AddressAvailability, useAddressCheck } from "@/components/orgs/AddressAvailability";
import { Button } from "@/components/ui/button";
import { Field, Input, PrefixInput, Textarea } from "@/components/ui/field";
import { slugify } from "@/lib/slug";

type Values = { name: string; slug: string; message: string };

type Props = {
  /** `workspaces.requireApproval`: false means sending creates the organisation straight away. */
  requireApproval?: boolean;
  /** Editing a pending request: its id and current values. */
  edit?: { requestId: string; initial: Values; onDone: () => void };
};

const EMPTY: Values = { name: "", slug: "", message: "" };

/** Name, address and reason for a new organisation, or changes to a pending request. The address is checked as you type. */
export function RequestOrganisationForm({ requireApproval = true, edit }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [values, setValues] = useState<Values>(edit?.initial ?? EMPTY);
  const [slugEdited, setSlugEdited] = useState(Boolean(edit));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const address = useAddressCheck(values.slug, edit?.requestId);
  const submitLabel = edit ? "Save changes" : requireApproval ? "Send request" : "Create organisation";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = edit ? await updateOrganisationRequest(edit.requestId, values) : await requestNewOrganisation(values);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        showToast(result.error, "error");
        return;
      }
      setErrors({});
      if (edit) {
        showToast("Request updated.", "success");
        edit.onDone();
        router.refresh();
        return;
      }
      setValues(EMPTY);
      setSlugEdited(false);
      const created = (result.data as { workspaceSlug?: string | null } | undefined)?.workspaceSlug;
      if (created) {
        showToast("Organisation created. You're its owner.", "success");
        router.push(`/w/${created}`);
        return;
      }
      showToast("Request sent. We'll email you when it's decided.", "success");
      router.refresh();
    });
  }

  return (
    <form className="flex max-w-xl flex-col gap-4" onSubmit={submit}>
      <Field label="Organisation name" required error={errors.name?.[0]}>
        <Input value={values.name} maxLength={80} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value, slug: slugEdited ? v.slug : slugify(e.target.value, "") }))} />
      </Field>
      <Field label="Address" required error={errors.slug?.[0]} helperText="Lowercase letters, numbers and hyphens. Members open it at this address.">
        <PrefixInput prefix="/w/" value={values.slug} maxLength={60} onChange={(e) => { setSlugEdited(true); setValues((v) => ({ ...v, slug: e.target.value.toLowerCase() })); }} />
      </Field>
      <AddressAvailability state={address} />
      <Field label="What is it for?" optional helperText={requireApproval ? "A line or two helps the instance admin decide." : undefined} error={errors.message?.[0]}>
        <Textarea rows={3} maxLength={1000} value={values.message} onChange={(e) => setValues((v) => ({ ...v, message: e.target.value }))} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" loading={pending} disabled={address.kind === "taken"}>{submitLabel}</Button>
        {edit ? <Button variant="quiet" onClick={edit.onDone} disabled={pending}>Cancel</Button> : null}
      </div>
    </form>
  );
}
