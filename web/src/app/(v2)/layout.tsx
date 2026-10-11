import { IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";
import "./v2.css";

const serif = Source_Serif_4({ subsets: ["latin"], weight: ["600"], variable: "--font-serif", display: "swap" });
const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex", display: "swap" });

// v2 screens. The nav only lists what already exists; Personas, Metas and
// Practicar join it in their own PRs.
export default function V2Layout({ children }: { children: React.ReactNode }) {
  return <div className={`v2 ${serif.variable} ${plex.variable}`}>{children}</div>;
}
