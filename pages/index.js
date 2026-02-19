import { useState } from "react";
import { useRouter } from "next/router";
import { generateGuestId, saveSession } from "../lib/helpers";

export default function Home() {
  const [phone, setPhone] = useState("");
  const router = useRouter();

  const handleContinue = () => {
    if (!phone) return;

    const displayId = generateGuestId();

    const session = {
      display_id: displayId,
      phone,
      type: "guest",
      created_at: new Date().toISOString(),
    };

    console.log('Session to save:', session);

    saveSession(session);

    router.push("/upload");
  };

  return (
    <div>
      <h1>Bienvenue sur Derewol</h1>
      <input
        type="text"
        placeholder="Numéro de téléphone"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <button onClick={handleContinue}>Continuer</button>
    </div>
  );
}
