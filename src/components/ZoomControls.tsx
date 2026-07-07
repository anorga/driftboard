import { Maximize, Minus, Plus } from "lucide-react";
import type { BoardElement, Camera } from "../lib/types";
import { fitCamera, zoomAt } from "../lib/geometry";

interface Props {
  camera: Camera;
  setCamera: React.Dispatch<React.SetStateAction<Camera>>;
  els: BoardElement[];
  viewportSize: () => { width: number; height: number };
}

export function ZoomControls({ camera, setCamera, els, viewportSize }: Props) {
  const center = () => {
    const { width, height } = viewportSize();
    return { x: width / 2, y: height / 2 };
  };
  const zoomBy = (factor: number) =>
    setCamera((cam) => zoomAt(cam, center(), cam.z * factor));
  const reset = () =>
    setCamera((cam) => zoomAt(cam, center(), 1));
  const fit = () => setCamera((cam) => fitCamera(els, viewportSize(), cam));

  return (
    <div className="pointer-events-auto absolute bottom-5 right-4 z-20 flex items-center gap-0.5 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-1.5 shadow-lg backdrop-blur-md">
      <button
        title="Zoom out"
        onClick={() => zoomBy(1 / 1.2)}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--text)] hover:bg-[var(--hover)]"
      >
        <Minus size={16} />
      </button>
      <button
        title="Reset zoom"
        onClick={reset}
        className="w-14 rounded-xl py-2 text-center text-[12px] font-semibold tabular-nums text-[var(--text)] hover:bg-[var(--hover)]"
      >
        {Math.round(camera.z * 100)}%
      </button>
      <button
        title="Zoom in"
        onClick={() => zoomBy(1.2)}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--text)] hover:bg-[var(--hover)]"
      >
        <Plus size={16} />
      </button>
      <div className="mx-0.5 h-6 w-px bg-[var(--border)]" />
      <button
        title="Zoom to fit"
        onClick={fit}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--text)] hover:bg-[var(--hover)]"
      >
        <Maximize size={16} />
      </button>
    </div>
  );
}
