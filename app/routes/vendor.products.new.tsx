import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Collapsible,
  InlineStack,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { requireApprovedVendor } from "../services/vendor-auth.server";
import { unauthenticated } from "../shopify.server";
import { createVendorProduct } from "../services/products.server";
import { getOrCreateSettings } from "../models/settings.server";
import {
  parseNameFromSpeech,
  parsePriceFromSpeech,
  parseQuantityFromSpeech,
} from "../utils/parse-quick-product";

type AddMethod = "choose" | "easy" | "manual";
type SpeakField = "name" | "price" | "quantity";

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult:
    | ((event: {
        results: ArrayLike<
          ArrayLike<{ transcript: string; confidence?: number }>
        >;
      }) => void)
    | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const settings = await getOrCreateSettings(result.vendor.shop);
  return {
    requireProductApproval: settings.requireProductApproval,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const { vendor } = result;

  const form = await request.formData();
  const mode = String(form.get("mode") || "easy");
  const title = String(form.get("title") || "").trim();
  const descriptionHtml = String(form.get("description") || "").trim();
  const price = String(form.get("price") || "").trim();
  const inventoryQuantity = Number(form.get("inventoryQuantity") || 1);

  const images = form
    .getAll("media")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (mode !== "manual" && !images.length) {
    return { error: "Please add a photo of your product first." };
  }

  if (!title || !price || Number(price) < 0 || Number.isNaN(Number(price))) {
    return { error: "Please enter a name and a price." };
  }

  const settings = await getOrCreateSettings(vendor.shop);
  const status = settings.requireProductApproval ? "DRAFT" : "ACTIVE";

  try {
    const { admin } = await unauthenticated.admin(vendor.shop);
    await createVendorProduct(admin, {
      vendorId: vendor.id,
      vendorName: vendor.name,
      title,
      descriptionHtml,
      price,
      inventoryQuantity: Number.isFinite(inventoryQuantity)
        ? Math.max(0, inventoryQuantity)
        : 1,
      status,
      images,
    });
    return redirect("/vendor/products");
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.",
    };
  }
};

function Step({
  number,
  title,
  hint,
  children,
  locked,
}: {
  number: number;
  title: string;
  hint?: string;
  children: ReactNode;
  locked?: boolean;
}) {
  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingLg">
            {number}. {title}
          </Text>
          {hint ? (
            <Text as="p" variant="bodyLg" tone="subdued">
              {hint}
            </Text>
          ) : null}
          {locked ? (
            <Banner tone="warning">
              Add a photo in step 1 first, then you can speak here.
            </Banner>
          ) : null}
        </BlockStack>
        <div style={locked ? { opacity: 0.45, pointerEvents: "none" } : undefined}>
          {children}
        </div>
      </BlockStack>
    </Card>
  );
}

export default function VendorAddProduct() {
  const { requireProductApproval } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const busy = navigation.state !== "idle";

  const galleryInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [inventoryQuantity, setInventoryQuantity] = useState("1");
  const [showMore, setShowMore] = useState(false);
  const [listeningFor, setListeningFor] = useState<SpeakField | null>(null);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechHint, setSpeechHint] = useState<string | null>(null);
  const [lastHeard, setLastHeard] = useState<string | null>(null);
  const [phase, setPhase] = useState<"edit" | "preview">("edit");
  const [method, setMethod] = useState<AddMethod>("choose");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const hasPhoto = Boolean(photo && preview);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  }, []);

  useEffect(() => {
    setSpeechSupported(Boolean(getSpeechRecognition()));
    return () => {
      recognitionRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!cameraOpen || !streamRef.current || !videoRef.current) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    void video.play().catch(() => {
      setCameraError("Could not start the camera preview. Try again.");
    });
  }, [cameraOpen]);

  const applyPhoto = useCallback((file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    setPhoto(file);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setSpeechHint("Photo ready. Now speak the name (step 2).");
  }, []);

  const openLaptopCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        "This browser cannot open the laptop camera. Use Choose from gallery, or try Chrome.",
      );
      return;
    }

    setCameraError(null);
    setCameraStarting(true);
    stopCamera();

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
      } catch {
        // Laptops usually only have a front webcam
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
      }
      streamRef.current = stream;
      setCameraOpen(true);
      setCameraStarting(false);
      setSpeechHint("Camera is on. Point at your product, then tap Take photo.");
    } catch {
      setCameraStarting(false);
      setCameraOpen(false);
      setCameraError(
        "Could not open the camera. Allow camera permission in your browser, then try again. Or choose a photo from your files.",
      );
    }
  }, [stopCamera]);

  const captureFromWebcam = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setCameraError(
        "Camera is still starting. Wait a second, then tap Take photo.",
      );
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraError("Could not capture the photo. Try again.");
          return;
        }
        const file = new File([blob], `product-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        applyPhoto(file);
        stopCamera();
      },
      "image/jpeg",
      0.92,
    );
  }, [applyPhoto, stopCamera]);

  const onFileInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      applyPhoto(event.target.files?.[0]);
      event.target.value = "";
    },
    [applyPhoto],
  );

  const clearPhoto = useCallback(() => {
    stopCamera();
    setPhoto(null);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPhase("edit");
    setSpeechHint("Add a photo first, then speak.");
  }, [stopCamera]);

  const applyFieldSpeech = useCallback(
    (field: SpeakField, transcript: string) => {
      setLastHeard(transcript);
      if (field === "name") {
        const name = parseNameFromSpeech(transcript);
        if (!name) {
          setSpeechHint(
            'Did not catch the name. Say clearly: "Red inabel scarf"',
          );
          return;
        }
        setTitle(name);
        setSpeechHint(`Name saved: “${name}”. Next, say the price.`);
        return;
      }
      if (field === "price") {
        const parsed = parsePriceFromSpeech(transcript);
        if (!parsed) {
          setSpeechHint(
            'Did not catch the price. Say: "250" or "two hundred fifty pesos"',
          );
          return;
        }
        setPrice(parsed);
        setSpeechHint(
          `Price saved: ₱${parsed}. Optional: say how many, then tap Preview my product.`,
        );
        return;
      }
      const qty = parseQuantityFromSpeech(transcript);
      if (!qty) {
        setSpeechHint('Did not catch the quantity. Say: "3" or "three pieces"');
        return;
      }
      setInventoryQuantity(qty);
      setSpeechHint(`Quantity saved: ${qty}. Tap Preview my product to check.`);
    },
    [],
  );

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.abort?.();
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
    setListeningFor(null);
  }, []);

  const startListening = useCallback(
    (field: SpeakField) => {
      if (!hasPhoto) {
        setSpeechHint("Please add a photo first (step 1).");
        return;
      }

      const Ctor = getSpeechRecognition();
      if (!Ctor) {
        setSpeechHint(
          "Voice is not available on this browser. Type in the boxes instead.",
        );
        return;
      }

      // Fully stop any previous session before starting (fixes steps 3–4 failing)
      try {
        recognitionRef.current?.abort?.();
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;

      const prompts: Record<SpeakField, string> = {
        name: 'Listening for name… say only the name, like "Red inabel scarf"',
        price: 'Listening for price… say only the price, like "250" or "250 pesos"',
        quantity: 'Listening for quantity… say only how many, like "3"',
      };

      setListeningFor(field);
      setSpeechHint(prompts[field]);

      window.setTimeout(() => {
        try {
          const recognition = new Ctor();
          recognitionRef.current = recognition;
          recognition.lang = "en-PH";
          recognition.interimResults = false;
          recognition.maxAlternatives = 5;
          recognition.continuous = false;
          recognition.onresult = (event) => {
            const alternatives = event.results[0];
            let best = "";
            for (let i = 0; i < (alternatives?.length || 0); i++) {
              const t = alternatives[i]?.transcript || "";
              if (!t) continue;
              if (!best) best = t;
              if (field === "name" && parseNameFromSpeech(t)) {
                best = t;
                break;
              }
              if (field === "price" && parsePriceFromSpeech(t)) {
                best = t;
                break;
              }
              if (field === "quantity" && parseQuantityFromSpeech(t)) {
                best = t;
                break;
              }
            }
            if (best) applyFieldSpeech(field, best);
            else setSpeechHint("No speech heard. Tap the button and try again.");
          };
          recognition.onerror = (event) => {
            setListeningFor(null);
            const err = event.error || "";
            if (err === "aborted") return;
            if (err === "not-allowed") {
              setSpeechHint(
                "Microphone is blocked. Allow mic access, or type in the boxes.",
              );
            } else if (err === "no-speech") {
              setSpeechHint(
                "No speech heard. Tap again and speak a little louder, or type below.",
              );
            } else {
              setSpeechHint(
                "Could not hear clearly. Tap again, or type the number below.",
              );
            }
          };
          recognition.onend = () => setListeningFor(null);
          recognition.start();
        } catch {
          setListeningFor(null);
          setSpeechHint(
            "Could not start the microphone. Type the price or quantity below.",
          );
        }
      }, 250);
    },
    [applyFieldSpeech, hasPhoto],
  );

  const bumpQty = useCallback((delta: number) => {
    setInventoryQuantity((prev) => {
      const next = Math.max(0, (Number(prev) || 0) + delta);
      return String(next);
    });
  }, []);

  const onPriceChange = useCallback((value: string) => {
    // Allow digits and one decimal — avoids number-input bugs
    const cleaned = value.replace(/[^\d.]/g, "");
    const parts = cleaned.split(".");
    const normalized =
      parts.length <= 1
        ? cleaned
        : `${parts[0]}.${parts.slice(1).join("").slice(0, 2)}`;
    setPrice(normalized);
  }, []);

  const onQtyChange = useCallback((value: string) => {
    const cleaned = value.replace(/[^\d]/g, "");
    setInventoryQuantity(cleaned === "" ? "0" : cleaned);
  }, []);

  const canPreviewEasy =
    hasPhoto && title.trim().length > 0 && price.trim().length > 0;
  const canPreviewManual =
    title.trim().length > 0 && price.trim().length > 0;
  const canPreview = method === "manual" ? canPreviewManual : canPreviewEasy;

  const handleSave = useCallback(() => {
    const fd = new FormData();
    fd.set("mode", method === "manual" ? "manual" : "easy");
    fd.set("title", title);
    fd.set("description", description);
    fd.set("price", price);
    fd.set("inventoryQuantity", inventoryQuantity || "1");
    if (photo) fd.append("media", photo, photo.name);
    submit(fd, { method: "post", encType: "multipart/form-data" });
  }, [method, title, description, price, inventoryQuantity, photo, submit]);

  const goToPreview = useCallback(() => {
    if (!canPreview) return;
    stopListening();
    stopCamera();
    setPhase("preview");
    setSpeechHint(null);
  }, [canPreview, stopCamera, stopListening]);

  const backToEdit = useCallback(() => {
    setPhase("edit");
  }, []);

  const backToChoose = useCallback(() => {
    stopListening();
    stopCamera();
    setPhase("edit");
    setMethod("choose");
  }, [stopCamera, stopListening]);

  const pageTitle =
    phase === "preview"
      ? "Check your product"
      : method === "manual"
        ? "Add product (type)"
        : method === "easy"
          ? "Add product (photo + speak)"
          : "Add a product";

  const pageBack =
    phase === "preview"
      ? { content: "Go back and change", onAction: backToEdit }
      : method !== "choose"
        ? { content: "Change method", onAction: backToChoose }
        : { content: "Back to my products", url: "/vendor/products" };

  return (
    <Page title={pageTitle} backAction={pageBack}>
      <div className="photo-first-add">
        <BlockStack gap="500">
          {actionData && "error" in actionData && actionData.error && (
            <Banner tone="critical">{actionData.error}</Banner>
          )}

          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={onFileInput}
          />

          {method === "choose" && (
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">
                  How do you want to add a product?
                </Text>
                <Text as="p" variant="bodyLg" tone="subdued">
                  Pick the way that feels easiest for you.
                </Text>
                <Button
                  variant="primary"
                  size="large"
                  fullWidth
                  onClick={() => setMethod("easy")}
                >
                  1. Photo + speak (easy)
                </Button>
                <Text as="p" tone="subdued">
                  Take a photo, then speak the name and price.
                </Text>
                <Button size="large" fullWidth onClick={() => setMethod("manual")}>
                  2. Type it yourself (manual)
                </Button>
                <Text as="p" tone="subdued">
                  Fill in the name, price, and other details by typing.
                </Text>
              </BlockStack>
            </Card>
          )}

          {phase === "preview" && method !== "choose" ? (
            <>
              <Banner tone="success">
                Looks ready. Check the photo and details below. If everything is
                correct, tap Save my product.
              </Banner>

              {requireProductApproval && (
                <Banner tone="info">
                  After you save, the store owner will check it before shoppers
                  can buy.
                </Banner>
              )}

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingLg">
                    Product preview
                  </Text>
                  {preview ? (
                    <img
                      src={preview}
                      alt={title}
                      style={{
                        width: "100%",
                        maxHeight: 420,
                        objectFit: "cover",
                        borderRadius: 12,
                        display: "block",
                      }}
                    />
                  ) : (
                    <Banner tone="warning">
                      No photo added. You can go back and add one, or save
                      without a photo.
                    </Banner>
                  )}

                  <div
                    style={{
                      background: "#f6f6f7",
                      borderRadius: 12,
                      padding: 20,
                    }}
                  >
                    <BlockStack gap="300">
                      <div>
                        <Text as="p" tone="subdued" variant="bodyMd">
                          Name
                        </Text>
                        <Text as="p" variant="headingLg">
                          {title}
                        </Text>
                      </div>
                      <div>
                        <Text as="p" tone="subdued" variant="bodyMd">
                          Price
                        </Text>
                        <Text as="p" variant="headingLg">
                          ₱{price}
                        </Text>
                      </div>
                      <div>
                        <Text as="p" tone="subdued" variant="bodyMd">
                          Shop location quantity
                        </Text>
                        <Text as="p" variant="headingMd">
                          {inventoryQuantity || "1"} piece
                          {inventoryQuantity === "1" ? "" : "s"}
                        </Text>
                      </div>
                      {description.trim() ? (
                        <div>
                          <Text as="p" tone="subdued" variant="bodyMd">
                            About it
                          </Text>
                          <Text as="p" variant="bodyLg">
                            {description}
                          </Text>
                        </div>
                      ) : null}
                    </BlockStack>
                  </div>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Button
                    variant="primary"
                    size="large"
                    fullWidth
                    loading={busy}
                    onClick={handleSave}
                  >
                    Looks good — Save my product
                  </Button>
                  <Button size="large" fullWidth onClick={backToEdit}>
                    Go back and change
                  </Button>
                </BlockStack>
              </Card>
            </>
          ) : method === "easy" ? (
            <>
              <Text as="p" variant="bodyLg">
                First take a photo, then speak the name and price. You will see
                a preview before saving.
              </Text>

              {requireProductApproval && (
                <Banner tone="info">
                  After you save, the store owner will check it before shoppers
                  can buy.
                </Banner>
              )}

          <Step
            number={1}
            title="Take a photo of your product"
            hint="This comes first. Open your laptop camera, or choose a picture from your files."
          >
            {cameraError ? (
              <Banner tone="critical" onDismiss={() => setCameraError(null)}>
                {cameraError}
              </Banner>
            ) : null}

            {cameraOpen ? (
              <BlockStack gap="300">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{
                    width: "100%",
                    maxHeight: 420,
                    objectFit: "cover",
                    borderRadius: 12,
                    background: "#111",
                    display: "block",
                    transform: "scaleX(-1)",
                  }}
                />
                <Button
                  variant="primary"
                  size="large"
                  fullWidth
                  onClick={captureFromWebcam}
                >
                  Take photo
                </Button>
                <Button size="large" fullWidth onClick={stopCamera}>
                  Close camera
                </Button>
              </BlockStack>
            ) : preview ? (
              <BlockStack gap="300">
                <img
                  src={preview}
                  alt="Your product"
                  style={{
                    width: "100%",
                    maxHeight: 360,
                    objectFit: "cover",
                    borderRadius: 12,
                    display: "block",
                  }}
                />
                <InlineStack gap="300">
                  <Button size="large" onClick={openLaptopCamera}>
                    Take another photo
                  </Button>
                  <Button size="large" tone="critical" onClick={clearPhoto}>
                    Remove photo
                  </Button>
                </InlineStack>
              </BlockStack>
            ) : (
              <BlockStack gap="300">
                <Button
                  variant="primary"
                  size="large"
                  fullWidth
                  loading={cameraStarting}
                  onClick={openLaptopCamera}
                >
                  Open camera
                </Button>
                <Button
                  size="large"
                  fullWidth
                  onClick={() => galleryInputRef.current?.click()}
                >
                  Choose from gallery
                </Button>
              </BlockStack>
            )}
          </Step>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingLg">
                Speak guide
              </Text>
              <Text as="p" variant="bodyLg">
                After your photo, speak <strong>one thing at a time</strong>.
              </Text>
              <div
                style={{
                  background: "#f6f6f7",
                  borderRadius: 12,
                  padding: 16,
                }}
              >
                <BlockStack gap="200">
                  <Text as="p" variant="bodyLg">
                    <strong>Name:</strong> “Red inabel scarf”
                  </Text>
                  <Text as="p" variant="bodyLg">
                    <strong>Price:</strong> “250 pesos”
                  </Text>
                  <Text as="p" variant="bodyLg">
                    <strong>Shop quantity:</strong> “3 pieces” (optional)
                  </Text>
                </BlockStack>
              </div>
              {!hasPhoto ? (
                <Banner tone="warning">
                  Finish step 1 (photo) before speaking.
                </Banner>
              ) : null}
              {!speechSupported ? (
                <Banner tone="warning">
                  Voice is not available here. Type in the boxes below instead
                  (Chrome on phone works best).
                </Banner>
              ) : null}
            </BlockStack>
          </Card>

          <Step
            number={2}
            title="Say the product name"
            hint='Tap the button, then say only the name. Example: "Red inabel scarf"'
            locked={!hasPhoto}
          >
            <BlockStack gap="300">
              <Button
                variant={title ? undefined : "primary"}
                size="large"
                fullWidth
                disabled={!hasPhoto}
                tone={listeningFor === "name" ? "critical" : undefined}
                onClick={() =>
                  listeningFor === "name"
                    ? stopListening()
                    : startListening("name")
                }
              >
                {listeningFor === "name"
                  ? "Listening… tap to stop"
                  : title
                    ? "Say name again"
                    : "Tap and say the name"}
              </Button>
              <TextField
                label="Name (you can fix it here)"
                value={title}
                onChange={setTitle}
                autoComplete="off"
                placeholder="Red inabel scarf"
                disabled={!hasPhoto}
                helpText={title ? "✓ Name ready" : "Waiting for name"}
              />
            </BlockStack>
          </Step>

          <Step
            number={3}
            title="Say or type the price"
            hint='Tap speak and say "250", or type the price in the box.'
            locked={!hasPhoto}
          >
            <BlockStack gap="300">
              <Button
                variant={price ? undefined : "primary"}
                size="large"
                fullWidth
                disabled={!hasPhoto}
                tone={listeningFor === "price" ? "critical" : undefined}
                onClick={() =>
                  listeningFor === "price"
                    ? stopListening()
                    : startListening("price")
                }
              >
                {listeningFor === "price"
                  ? "Listening… tap to stop"
                  : price
                    ? "Say price again"
                    : "Tap and say the price"}
              </Button>
              <TextField
                label="Price (type here if speak fails)"
                type="text"
                inputMode="decimal"
                value={price}
                onChange={onPriceChange}
                autoComplete="off"
                prefix="₱"
                placeholder="250"
                disabled={!hasPhoto}
                helpText={price ? "✓ Price ready" : "Type or speak the price"}
              />
            </BlockStack>
          </Step>

          <Step
            number={4}
            title="Shop location quantity (optional)"
            hint="How many pieces are ready at the shop location. Speak, type, or use + and −. If you skip, we use 1."
            locked={!hasPhoto}
          >
            <BlockStack gap="300">
              <Button
                size="large"
                fullWidth
                disabled={!hasPhoto}
                tone={listeningFor === "quantity" ? "critical" : undefined}
                onClick={() =>
                  listeningFor === "quantity"
                    ? stopListening()
                    : startListening("quantity")
                }
              >
                {listeningFor === "quantity"
                  ? "Listening… tap to stop"
                  : "Tap and say how many at the shop"}
              </Button>
              <InlineStack gap="300" blockAlign="center">
                <Button
                  size="large"
                  disabled={!hasPhoto}
                  onClick={() => bumpQty(-1)}
                >
                  −
                </Button>
                <div style={{ flex: 1, minWidth: 100 }}>
                  <TextField
                    label="Shop location quantity"
                    labelHidden
                    type="text"
                    inputMode="numeric"
                    value={inventoryQuantity}
                    onChange={onQtyChange}
                    autoComplete="off"
                    disabled={!hasPhoto}
                    align="center"
                  />
                </div>
                <Button
                  size="large"
                  disabled={!hasPhoto}
                  onClick={() => bumpQty(1)}
                >
                  +
                </Button>
              </InlineStack>
            </BlockStack>
          </Step>

          {(speechHint || lastHeard) && (
            <Banner tone={listeningFor ? "info" : "success"}>
              <BlockStack gap="100">
                {speechHint ? <Text as="p">{speechHint}</Text> : null}
                {lastHeard ? (
                  <Text as="p" tone="subdued">
                    Heard: “{lastHeard}”
                  </Text>
                ) : null}
              </BlockStack>
            </Banner>
          )}

          <Card>
            <BlockStack gap="300">
              <Button
                onClick={() => setShowMore((v) => !v)}
                disclosure={showMore ? "up" : "down"}
              >
                More options (optional)
              </Button>
              <Collapsible open={showMore} id="more-options">
                <TextField
                  label="Say a little more about it"
                  value={description}
                  onChange={setDescription}
                  multiline={3}
                  autoComplete="off"
                  placeholder="Color, size, material…"
                />
              </Collapsible>
            </BlockStack>
          </Card>

              <Card>
                <BlockStack gap="300">
                  <Button
                    variant="primary"
                    size="large"
                    fullWidth
                    disabled={!canPreview}
                    onClick={goToPreview}
                  >
                    Preview my product
                  </Button>
                  <Button size="large" fullWidth onClick={backToChoose}>
                    Change method
                  </Button>
                  {!canPreview ? (
                    <Text as="p" alignment="center" tone="subdued">
                      {!hasPhoto
                        ? "Add a photo first (step 1)"
                        : "Then add a name and price by speaking (or typing)"}
                    </Text>
                  ) : (
                    <Text as="p" alignment="center" tone="subdued">
                      Next you will check a preview before saving
                    </Text>
                  )}
                </BlockStack>
              </Card>
            </>
          ) : method === "manual" ? (
            <>
              <Text as="p" variant="bodyLg">
                Type the details yourself. Photo is optional but helpful.
              </Text>

              {requireProductApproval && (
                <Banner tone="info">
                  After you save, the store owner will check it before shoppers
                  can buy.
                </Banner>
              )}

              <Step
                number={1}
                title="Product name"
                hint="Example: Red inabel scarf"
              >
                <TextField
                  label="Name"
                  labelHidden
                  value={title}
                  onChange={setTitle}
                  autoComplete="off"
                  placeholder="Type the product name"
                  autoFocus
                />
              </Step>

              <Step
                number={2}
                title="Price"
                hint="Example: 250 or 250.00"
              >
                <TextField
                  label="Price"
                  labelHidden
                  type="text"
                  inputMode="decimal"
                  value={price}
                  onChange={onPriceChange}
                  autoComplete="off"
                  prefix="₱"
                  placeholder="0.00"
                />
              </Step>

              <Step
                number={3}
                title="Shop location quantity"
                hint="Pieces ready at the shop. Use + and − if that is easier."
              >
                <InlineStack gap="300" blockAlign="center">
                  <Button size="large" onClick={() => bumpQty(-1)}>
                    −
                  </Button>
                  <div style={{ flex: 1, minWidth: 100 }}>
                    <TextField
                      label="Shop location quantity"
                      labelHidden
                      type="text"
                      inputMode="numeric"
                      value={inventoryQuantity}
                      onChange={onQtyChange}
                      autoComplete="off"
                      align="center"
                    />
                  </div>
                  <Button size="large" onClick={() => bumpQty(1)}>
                    +
                  </Button>
                </InlineStack>
              </Step>

              <Step
                number={4}
                title="Description (optional)"
                hint="You can leave this blank"
              >
                <TextField
                  label="Description"
                  labelHidden
                  value={description}
                  onChange={setDescription}
                  multiline={4}
                  autoComplete="off"
                  placeholder="Color, size, material…"
                />
              </Step>

              <Step
                number={5}
                title="Photo (optional)"
                hint="Open your camera or choose a picture from your files."
              >
                {cameraError ? (
                  <Banner tone="critical" onDismiss={() => setCameraError(null)}>
                    {cameraError}
                  </Banner>
                ) : null}

                {cameraOpen ? (
                  <BlockStack gap="300">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      style={{
                        width: "100%",
                        maxHeight: 360,
                        objectFit: "cover",
                        borderRadius: 12,
                        background: "#111",
                        display: "block",
                        transform: "scaleX(-1)",
                      }}
                    />
                    <Button
                      variant="primary"
                      size="large"
                      fullWidth
                      onClick={captureFromWebcam}
                    >
                      Take photo
                    </Button>
                    <Button size="large" fullWidth onClick={stopCamera}>
                      Close camera
                    </Button>
                  </BlockStack>
                ) : preview ? (
                  <BlockStack gap="300">
                    <img
                      src={preview}
                      alt="Your product"
                      style={{
                        width: "100%",
                        maxHeight: 280,
                        objectFit: "cover",
                        borderRadius: 12,
                        display: "block",
                      }}
                    />
                    <InlineStack gap="300">
                      <Button size="large" onClick={openLaptopCamera}>
                        Change photo
                      </Button>
                      <Button size="large" tone="critical" onClick={clearPhoto}>
                        Remove photo
                      </Button>
                    </InlineStack>
                  </BlockStack>
                ) : (
                  <BlockStack gap="300">
                    <Button
                      size="large"
                      fullWidth
                      loading={cameraStarting}
                      onClick={openLaptopCamera}
                    >
                      Open camera
                    </Button>
                    <Button
                      size="large"
                      fullWidth
                      onClick={() => galleryInputRef.current?.click()}
                    >
                      Choose from gallery
                    </Button>
                  </BlockStack>
                )}
              </Step>

              <Card>
                <BlockStack gap="300">
                  <Button
                    variant="primary"
                    size="large"
                    fullWidth
                    disabled={!canPreview}
                    onClick={goToPreview}
                  >
                    Preview my product
                  </Button>
                  <Button size="large" fullWidth onClick={backToChoose}>
                    Change method
                  </Button>
                  {!canPreview ? (
                    <Text as="p" alignment="center" tone="subdued">
                      Enter a name and price to continue
                    </Text>
                  ) : null}
                </BlockStack>
              </Card>
            </>
          ) : null}
        </BlockStack>
      </div>

      <style>{`
        .photo-first-add {
          max-width: 560px;
          margin: 0 auto;
          padding-bottom: 48px;
        }
        .photo-first-add .Polaris-TextField__Input,
        .photo-first-add .Polaris-TextField__Input::placeholder {
          font-size: 1.15rem !important;
          line-height: 1.5 !important;
          min-height: 48px;
        }
        .photo-first-add textarea.Polaris-TextField__Input {
          min-height: 100px;
        }
        .photo-first-add .Polaris-Button--sizeLarge {
          min-height: 52px;
          font-size: 1.1rem;
        }
      `}</style>
    </Page>
  );
}
