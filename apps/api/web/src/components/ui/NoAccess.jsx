import { Lock } from "lucide-react";
import EmptyState from "./EmptyState";

export default function NoAccess({ what = "this page" }) {
  return <EmptyState icon={<Lock />} title="You don't have access" text={`Your role doesn't include ${what}. Ask an admin if you think this is a mistake.`} />;
}
