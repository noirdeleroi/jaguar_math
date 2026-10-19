import type { Metadata } from "next";
import StandaloneGrapher from "./standalone-grapher";

export const metadata: Metadata = {
  title: "Jaguar Grapher | Jaguar Math",
  description: "A free interactive graphing workspace for SAT Math practice.",
};

export default function GrapherPage() {
  return <StandaloneGrapher />;
}
