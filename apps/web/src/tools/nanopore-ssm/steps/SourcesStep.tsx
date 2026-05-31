// Nanopore SSM — Sources step. Wires project name + pipeline-mode toggle +
// (multiplexed mode) FASTQ picker. In per-round mode the picker is hidden;
// each round picks its file on the Configure step.

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Cloud,
  FileText,
  Files,
  FolderOpen,
  Layers,
  Microscope,
  Sparkles,
  X,
} from "lucide-react";
import {
  NP_DEMO_REFERENCE,
  NP_DEMO_SITES,
  loadDemoFastqs,
} from "@/tools/nanopore-ssm/demo";
import {
  canContinueFromSources,
  useNanoporeStore,
  type DriveFileRef,
} from "@/state/useNanoporeStore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DriveAuthProvider,
  isDriveSignedIn,
} from "@/adapters/DriveAuthProvider";
import { showDrivePicker } from "@/adapters/DrivePicker";
import {
  peekFastq,
  sanitizeProjectName,
  validateFastqFileSync,
  validateProjectName,
} from "@/lib/validation";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;

export function SourcesStep() {
  const projectName = useNanoporeStore((s) => s.projectName);
  const setProjectName = useNanoporeStore((s) => s.setProjectName);
  const pipelineMode = useNanoporeStore((s) => s.pipelineMode);
  const setPipelineMode = useNanoporeStore((s) => s.setPipelineMode);
  const localFiles = useNanoporeStore((s) => s.localFiles);
  const driveFiles = useNanoporeStore((s) => s.driveFiles);
  const setLocalFiles = useNanoporeStore((s) => s.setLocalFiles);
  const setDriveFiles = useNanoporeStore((s) => s.setDriveFiles);
  const setReferenceSeq = useNanoporeStore((s) => s.setReferenceSeq);
  const setSites = useNanoporeStore((s) => s.setSites);
  const setRounds = useNanoporeStore((s) => s.setRounds);
  const setStep = useNanoporeStore((s) => s.setStep);
  const goNext = useNanoporeStore((s) => s.goNext);

  const projectErr = validateProjectName(projectName);
  const canContinue = useNanoporeStore(canContinueFromSources);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoErr, setDemoErr] = useState<string | null>(null);
  // After loading the demo, briefly highlight every prefilled field so the
  // user can see what was set without having to compare manually.
  const [demoLoadedAt, setDemoLoadedAt] = useState<number | null>(null);
  const demoActive = demoLoadedAt != null && Date.now() - demoLoadedAt < 8000;
  useEffect(() => {
    if (demoLoadedAt == null) return;
    const id = setTimeout(() => setDemoLoadedAt(null), 8000);
    return () => clearTimeout(id);
  }, [demoLoadedAt]);

  const handleLoadDemo = async () => {
    setDemoErr(null);
    setDemoBusy(true);
    try {
      // Pre-fill the form with the 1-site fixture's config + bundled FASTQs.
      setProjectName("test_nanopore_demo");
      setPipelineMode("per-round");
      setReferenceSeq(NP_DEMO_REFERENCE);
      setSites(
        NP_DEMO_SITES.map((s, i) => ({
          ...s,
          id: `np_site_${i}_${Math.random().toString(36).slice(2, 8)}`,
        })),
      );
      const bundle = await loadDemoFastqs();
      setRounds(
        bundle.map((b, i) => ({
          id: `np_round_${i}_${Math.random().toString(36).slice(2, 8)}`,
          name: b.round,
          barcode: "",
          file: b.file,
          driveRef: null,
        })),
      );
      setDemoLoadedAt(Date.now());
    } catch (e) {
      setDemoErr((e as Error).message);
    } finally {
      setDemoBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card className={demoActive ? "ring-2 ring-primary/40" : ""}>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Microscope className="h-4 w-4 text-primary" />
              Project
            </CardTitle>
            <CardDescription>Choose a name to identify this run.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => void handleLoadDemo()} disabled={demoBusy}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            {demoBusy ? "Loading demo…" : "Try with demo data"}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="np-project">Project name</Label>
            <Input
              id="np-project"
              placeholder="e.g. spike_K417_SSM_2026"
              value={projectName}
              onChange={(e) => {
                setDemoLoadedAt(null);
                setProjectName(sanitizeProjectName(e.target.value));
              }}
              className={demoActive ? "ring-2 ring-primary/40" : ""}
            />
            {projectErr && projectName ? (
              <p className="text-xs text-destructive">{projectErr}</p>
            ) : null}
            {demoErr && <p className="text-xs text-destructive">{demoErr}</p>}
            {demoActive && (
              <p className="flex items-center gap-1.5 text-xs text-primary">
                <Sparkles className="h-3 w-3" />
                Demo data loaded. Step through Configure → Preview → Run to see
                a complete walkthrough. Highlight fades in 8s.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pipeline mode</CardTitle>
          <CardDescription>
            Each round can live in its own FASTQ, or be demultiplexed from a single
            multiplexed run via anchor-embedded barcodes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ModeCard
              icon={Layers}
              active={pipelineMode === "multiplexed"}
              onClick={() => setPipelineMode("multiplexed")}
              title="Multiplexed"
              body="One or more shared FASTQs. Each round is identified by a short barcode prefix that sits in front of the upstream anchor."
            />
            <ModeCard
              icon={Files}
              active={pipelineMode === "per-round"}
              onClick={() => setPipelineMode("per-round")}
              title="Per-round"
              body="Each round owns its own FASTQ — picked alongside the round's name on the Configure step. No barcode needed."
            />
          </div>
        </CardContent>
      </Card>

      {pipelineMode === "multiplexed" ? (
        <MultiplexSources
          localFiles={localFiles}
          driveFiles={driveFiles}
          setLocalFiles={setLocalFiles}
          setDriveFiles={setDriveFiles}
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">FASTQ sources</CardTitle>
              <CardDescription>
                In per-round mode, each round's FASTQ is picked on the Configure step
                alongside its name. Nothing to do here for local files.
              </CardDescription>
            </CardHeader>
          </Card>
          <DriveSignInCard />
        </>
      )}

      <div className="flex justify-end">
        <Button onClick={goNext} disabled={!canContinue}>
          Continue
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function ModeCard({
  icon: Icon,
  active,
  onClick,
  title,
  body,
}: {
  icon: typeof Layers;
  active: boolean;
  onClick: () => void;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex items-start gap-3 rounded-md border p-3 text-left transition " +
        (active
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "hover:bg-muted/50")
      }
    >
      <Icon className="mt-0.5 h-4 w-4 text-primary" />
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{body}</div>
      </div>
    </button>
  );
}

function MultiplexSources({
  localFiles,
  driveFiles,
  setLocalFiles,
  setDriveFiles,
}: {
  localFiles: File[];
  driveFiles: DriveFileRef[];
  setLocalFiles: (fs: File[]) => void;
  setDriveFiles: (fs: DriveFileRef[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [drivePicking, setDrivePicking] = useState(false);
  const [driveErr, setDriveErr] = useState<string | null>(null);
  const [driveReady, setDriveReady] = useState(isDriveSignedIn());

  useEffect(() => {
    const id = setInterval(() => setDriveReady(isDriveSignedIn()), 1000);
    return () => clearInterval(id);
  }, []);

  const driveConfigured = !!(CLIENT_ID && API_KEY);

  const onPickedLocal = async (list: FileList | null) => {
    if (!list) return;
    const warn: string[] = [];
    const accepted: File[] = [];
    for (const f of Array.from(list)) {
      const sync = validateFastqFileSync(f);
      if (!sync.ok) {
        warn.push(`${f.name}: ${sync.reason}`);
        continue;
      }
      const peek = await peekFastq(f);
      if (!peek.ok && peek.level === "error") {
        warn.push(`${f.name}: ${peek.reason}`);
        continue;
      }
      if (peek.level === "warning" && peek.reason) {
        warn.push(`${f.name}: ${peek.reason} (loaded anyway)`);
      }
      accepted.push(f);
    }
    setWarnings(warn);
    if (accepted.length > 0) setLocalFiles([...localFiles, ...accepted]);
  };

  const onDriveClick = async () => {
    setDriveErr(null);
    if (!CLIENT_ID || !API_KEY) {
      setDriveErr("Drive isn't configured (missing OAuth client ID or API key).");
      return;
    }
    const auth = new DriveAuthProvider({ clientId: CLIENT_ID });
    try {
      setDrivePicking(true);
      const token = await auth.getToken();
      const projectNumber = CLIENT_ID.split("-")[0]!;
      const picked = await showDrivePicker({
        oauthToken: token,
        apiKey: API_KEY,
        appId: projectNumber,
      });
      if (picked.length === 0) return;
      const newOnes: DriveFileRef[] = picked.map((p) => ({
        id: p.id,
        name: p.name,
        sizeBytes: p.sizeBytes,
      }));
      setDriveFiles([...driveFiles, ...newOnes]);
    } catch (e) {
      setDriveErr(`Drive pick failed: ${(e as Error).message}`);
    } finally {
      setDrivePicking(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Shared FASTQ sources</CardTitle>
        <CardDescription>
          Drop the multiplexed Nanopore FASTQ(s). All rounds will be scanned out
          of these files using their per-round barcode + the shared anchor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="local">
          <TabsList>
            <TabsTrigger value="local">
              <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
              Local files
            </TabsTrigger>
            <TabsTrigger value="drive">
              <Cloud className="mr-1.5 h-3.5 w-3.5" />
              Google Drive
            </TabsTrigger>
          </TabsList>
          <TabsContent value="local" className="mt-3">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                void onPickedLocal(e.dataTransfer.files);
              }}
              onClick={() => inputRef.current?.click()}
              className={
                "cursor-pointer rounded-md border-2 border-dashed p-8 text-center text-sm transition " +
                (dragActive
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border bg-muted/30 text-muted-foreground hover:border-primary/50")
              }
            >
              Drop FASTQ files here or click to browse
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".fastq,.fq"
              className="hidden"
              onChange={(e) => {
                void onPickedLocal(e.target.files);
                if (inputRef.current) inputRef.current.value = "";
              }}
            />
          </TabsContent>
          <TabsContent value="drive" className="mt-3 space-y-2">
            {!driveConfigured ? (
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                Drive picker not configured. Set VITE_GOOGLE_CLIENT_ID and VITE_GOOGLE_API_KEY in .env.local.
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={drivePicking}
                onClick={() => void onDriveClick()}
              >
                <Cloud className="mr-1.5 h-3.5 w-3.5" />
                {drivePicking ? "Opening…" : driveReady ? "Pick from Drive…" : "Sign in + pick from Drive…"}
              </Button>
            )}
            {driveErr && <p className="text-xs text-destructive">{driveErr}</p>}
          </TabsContent>
        </Tabs>

        {warnings.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-warning">
            {warnings.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
        )}

        {(localFiles.length > 0 || driveFiles.length > 0) && (
          <div className="mt-4 space-y-1.5">
            <Label className="text-xs">Selected sources</Label>
            <ul className="space-y-1.5 text-xs">
              {localFiles.map((f, i) => (
                <li
                  key={`l-${i}`}
                  className="flex items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-1.5"
                >
                  <FileText className="h-3.5 w-3.5 text-primary" />
                  <Badge variant="outline" className="text-[10px]">
                    local
                  </Badge>
                  <span className="truncate font-mono">{f.name}</span>
                  <span className="ml-auto text-muted-foreground">
                    {formatBytes(f.size)}
                  </span>
                  <button
                    onClick={() => setLocalFiles(localFiles.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
              {driveFiles.map((d, i) => (
                <li
                  key={`d-${i}`}
                  className="flex items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-1.5"
                >
                  <Cloud className="h-3.5 w-3.5 text-primary" />
                  <Badge variant="outline" className="text-[10px]">
                    drive
                  </Badge>
                  <span className="truncate font-mono">{d.name}</span>
                  <span className="ml-auto text-muted-foreground">
                    {d.sizeBytes != null ? formatBytes(d.sizeBytes) : "—"}
                  </span>
                  <button
                    onClick={() => setDriveFiles(driveFiles.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Standalone Drive sign-in card — visible in per-round mode so the user
 *  can authenticate before going to Configure (where per-round Drive picks
 *  happen). OAuth redirects to Google; on return, sessionStorage has the
 *  token and the picker buttons on Configure unlock. */
function DriveSignInCard() {
  const [signedIn, setSignedIn] = useState(isDriveSignedIn());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const driveConfigured = !!(CLIENT_ID && API_KEY);

  // Refresh sign-in flag periodically so post-OAuth return flips the badge.
  useEffect(() => {
    const id = setInterval(() => setSignedIn(isDriveSignedIn()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!driveConfigured) return null;

  const handleSignIn = async () => {
    setErr(null);
    try {
      setBusy(true);
      const auth = new DriveAuthProvider({ clientId: CLIENT_ID! });
      // getToken() triggers an OAuth redirect when no valid token cached —
      // the tab navigates away, then back. Anything typed elsewhere in the
      // wizard is preserved by the store + sessionStorage; sign-in is meant
      // to happen BEFORE filling in Configure for that reason.
      await auth.getToken();
      setSignedIn(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    const auth = new DriveAuthProvider({ clientId: CLIENT_ID! });
    await auth.signOut();
    setSignedIn(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Google Drive (optional)</CardTitle>
        <CardDescription>
          Sign in here once; the per-round "Pick from Drive…" buttons on the
          Configure step will then work without further prompts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-3">
          <Badge
            variant="outline"
            className={signedIn ? "border-success text-success" : "text-muted-foreground"}
          >
            <Cloud className="mr-1.5 h-3 w-3" />
            {signedIn ? "Connected" : "Not signed in"}
          </Badge>
          {signedIn ? (
            <Button size="sm" variant="outline" onClick={() => void handleSignOut()}>
              Sign out
            </Button>
          ) : (
            <Button size="sm" onClick={() => void handleSignIn()} disabled={busy}>
              <Cloud className="mr-1.5 h-3.5 w-3.5" />
              {busy ? "Redirecting…" : "Sign in to Google Drive"}
            </Button>
          )}
          {err && <span className="text-xs text-destructive">{err}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
