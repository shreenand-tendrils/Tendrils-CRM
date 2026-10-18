import Avatar from "./Avatar";

export default function AvatarStack({ users = [], max = 3 }) {
  if (!users.length) return <small className="muted">Unassigned</small>;
  return (
    <span className="avatar-stack" title={users.map((u) => u.name || u.email).join(", ")}>
      {users.slice(0, max).map((u) => <Avatar key={u.id} name={u.name || u.email} />)}
      {users.length > max && <span className="avatar more">+{users.length - max}</span>}
    </span>
  );
}
