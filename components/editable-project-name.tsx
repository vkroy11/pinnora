"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { renameProject } from "@/app/actions/rename-project";

export function EditableProjectName({ projectId, name }: { projectId: string; name: string }) {
  const [value, setValue] = useState(name);
  const [editing, setEditing] = useState(false);
  const previous = useRef(name);

  async function commit() {
    setEditing(false);
    const trimmed = value.trim();
    if (!trimmed || trimmed === previous.current) {
      setValue(previous.current);
      return;
    }
    previous.current = trimmed;
    setValue(trimmed);
    try {
      await renameProject({ projectId, name: trimmed });
    } catch {
      setValue(previous.current);
    }
  }

  if (editing) {
    return (
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setValue(previous.current);
            setEditing(false);
          }
        }}
        className="h-8 w-56"
      />
    );
  }

  return (
    <h1
      className="cursor-text font-medium hover:underline"
      title="Click to rename"
      onClick={() => setEditing(true)}
    >
      {value}
    </h1>
  );
}
