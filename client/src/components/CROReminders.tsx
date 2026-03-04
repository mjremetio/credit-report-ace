import { useState } from "react";
import { MessageSquare, CheckCircle2 } from "lucide-react";

const DEFAULT_REMINDERS = [
  "Have you asked the client about all communication activity with this collector?",
  "Have you requested copies of ALL letters, texts, emails, and voicemails?",
  "Have you asked about any recorded calls?",
  "Does documentation support this violation for escalation?",
];

interface CRORemindersProps {
  accountCreditor: string;
  customReminders?: string[];
}

export default function CROReminders({ accountCreditor, customReminders }: CRORemindersProps) {
  const reminders = [...DEFAULT_REMINDERS, ...(customReminders || [])];
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const toggle = (index: number) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const allChecked = checked.size === reminders.length;

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-mono text-foreground flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          CRO Reminders — {accountCreditor}
        </h3>
        {allChecked && (
          <span className="text-[10px] font-mono text-green-600 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> All complete
          </span>
        )}
      </div>

      <div className="space-y-2">
        {reminders.map((reminder, i) => (
          <label
            key={i}
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
              checked.has(i)
                ? "border-green-500/20 bg-green-500/5"
                : "border-border bg-background hover:border-primary/20"
            }`}
          >
            <input
              type="checkbox"
              checked={checked.has(i)}
              onChange={() => toggle(i)}
              className="mt-0.5 accent-primary"
            />
            <span className={`text-xs font-mono ${checked.has(i) ? "text-green-600 line-through" : "text-muted-foreground"}`}>
              {reminder}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
