import Header from "../components/Header";
import IDCard from "../components/IDCard";
import { useSession } from "../context/SessionContext";

export default function Home() {
  const { session } = useSession();

  return (
    <main>
      <Header />
      {session && <IDCard session={session} />}
    </main>
  );
}
