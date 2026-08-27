"use client";

import { BlockMath, InlineMath } from "react-katex";

export default function MathText({ children }: { children: string }) {
  const pieces = children.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
  return <>{pieces.map((piece, index) => {
    if (piece.startsWith("$$") && piece.endsWith("$$")) return <BlockMath key={index} math={piece.slice(2, -2)} />;
    if (piece.startsWith("$") && piece.endsWith("$")) return <InlineMath key={index} math={piece.slice(1, -1)} />;
    return piece;
  })}</>;
}
