import { Chip } from "@/components/ui/display";

/** Current machine status: always a word, never colour alone. */
export function DowntimeChip({ down }: { down: boolean }) {
  return down ? <Chip tone="danger">Out of service</Chip> : <Chip tone="success">In service</Chip>;
}
