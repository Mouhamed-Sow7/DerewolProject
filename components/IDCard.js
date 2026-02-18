export default function IDCard({ session }) {
  return (
    <div className="id-card">
      <div>ID: {session.id}</div>
      <div>Type: {session.type}</div>
    </div>
  );
}
