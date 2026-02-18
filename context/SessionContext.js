import { createContext, useState, useContext, useEffect } from "react";
import { loadSession, saveSession } from "../lib/helpers";

const SessionContext = createContext();

export const SessionProvider = ({ children }) => {
  const [session, setSession] = useState(null);

  useEffect(() => {
    const s = loadSession();
    setSession(s);
  }, []);

  const updateSession = (newSession) => {
    setSession(newSession);
    saveSession(newSession);
  };

  return (
    <SessionContext.Provider value={{ session, updateSession }}>
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = () => useContext(SessionContext);
