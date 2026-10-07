import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
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
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { createVendorProduct } from "../services/products.server";
import { listVendors, getVendorById } from "../models/vendor.server";

type AddMethod = "choose" | "easy" | "manual";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const vendors = (await listVendors(session.shop)).filter(
    (v) => v.status === "approved",
  );
  return {
    vendors: vendors.map((v) => ({ id: v.id, name: v.name, email: v.email })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const form = await request.formData();
  const vendorId = String(form.get("vendorId") || "").trim();
  const mode = String(form.get("mode") || "easy");
  const title = String(form.get("title") || "").trim();
  const descriptionHtml = String(form.get("description") || "").trim();
  const price = String(form.get("price") || "").trim();
  const inventoryQuantity = Number(form.get("inventoryQuantity") || 1);
  const aiFeeRaw = String(form.get("aiCustomizationFee") || "").trim();

  if (!vendorId) {
    return { error: "Please choose a seller for this product." };
  }

  const vendor = await getVendorById(vendorId);
  if (!vendor || vendor.shop !== session.shop || vendor.status !== "approved") {
    return { error: "That seller is not available." };
  }

  const images = form
    .getAll("media")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (mode !== "manual" && !images.length) {
    return { error: "Please add a photo of your product first." };
  }

  if (!title || !price || Number(price) < 0 || Number.isNaN(Number(price))) {
    return { error: "Please enter a name and a price." };
  }

  let aiCustomizationFee: string | null = null;
  if (aiFeeRaw) {
    const feeNum = Number(aiFeeRaw);
    if (Number.isNaN(feeNum) || feeNum < 0) {
      return { error: "AI customization fee must be a valid amount (0 or more)." };
    }
    aiCustomizationFee = aiFeeRaw;
  }

  try {
    await createVendorProduct(admin, {
      vendorId: vendor.id,
      vendorName: vendor.name,
      title,
      descriptionHtml,
      price,
      inventoryQuantity: Number.isFinite(inventoryQuantity)
        ? Math.max(0, inventoryQuantity)
        : 1,
      status: "ACTIVE",
      images,
      aiCustomizationFee,
    });
    return redirect("/app/products");
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
              Add a photo in step 1 first, then fill this in.
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

export default function AdminAddProduct() {
  const { vendors } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const busy = navigation.state !== "idle";

  const galleryInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [vendorId, setVendorId] = useState(vendors[0]?.id || "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [aiCustomizationFee, setAiCustomizationFee] = useState("");
  const [description, setDescription] = useState("");
  const [inventoryQuantity, setInventoryQuantity] = useState("1");
  const [showMore, setShowMore] = useState(false);
  const [phase, setPhase] = useState<"edit" | "preview">("edit");
  const [method, setMethod] = useState<AddMethod>("choose");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const selectedVendor = vendors.find((v) => v.id === vendorId);

  const hasPhoto = Boolean(photo && preview);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  }, []);

  useEffect(() => {
    return () => {
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
  }, [stopCamera]);

  const bumpQty = useCallback((delta: number) => {
    setInventoryQuantity((prev) => {
      const next = Math.max(0, (Number(prev) || 0) + delta);
      return String(next);
    });
  }, []);

  const normalizeDecimal = useCallback((value: string) => {
    // Allow digits and one decimal — avoids number-input bugs
    const cleaned = value.replace(/[^\d.]/g, "");
    const parts = cleaned.split(".");
    return parts.length <= 1
      ? cleaned
      : `${parts[0]}.${parts.slice(1).join("").slice(0, 2)}`;
  }, []);

  const onPriceChange = useCallback(
    (value: string) => setPrice(normalizeDecimal(value)),
    [normalizeDecimal],
  );
  const onAiFeeChange = useCallback(
    (value: string) => setAiCustomizationFee(normalizeDecimal(value)),
    [normalizeDecimal],
  );

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
    fd.set("vendorId", vendorId);
    fd.set("mode", method === "manual" ? "manual" : "easy");
    fd.set("title", title);
    fd.set("description", description);
    fd.set("price", price);
    fd.set("inventoryQuantity", inventoryQuantity || "1");
    fd.set("aiCustomizationFee", aiCustomizationFee);
    if (photo) fd.append("media", photo, photo.name);
    submit(fd, { method: "post", encType: "multipart/form-data" });
  }, [
    vendorId,
    method,
    title,
    description,
    price,
    inventoryQuantity,
    aiCustomizationFee,
    photo,
    submit,
  ]);

  const goToPreview = useCallback(() => {
    if (!canPreview) return;
    stopCamera();
    setPhase("preview");
  }, [canPreview, stopCamera]);

  const backToEdit = useCallback(() => {
    setPhase("edit");
  }, []);

  const backToChoose = useCallback(() => {
    stopCamera();
    setPhase("edit");
    setMethod("choose");
  }, [stopCamera]);

  const pageTitle =
    phase === "preview"
      ? "Check your product"
      : method === "manual"
        ? "Add product (type)"
        : method === "easy"
          ? "Add product (photo)"
          : "Add a product";

  const pageBack =
    phase === "preview"
      ? { content: "Go back and change", onAction: backToEdit }
      : method !== "choose"
        ? { content: "Change method", onAction: backToChoose }
        : { content: "Back to products", url: "/app/products" };

  if (vendors.length === 0) {
    return (
      <Page
        title="Add a product"
        backAction={{ content: "Back to products", url: "/app/products" }}
      >
        <Banner tone="warning">
          Approve a seller first (Sellers page), then you can add products for
          them here.
        </Banner>
      </Page>
    );
  }

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

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Seller
              </Text>
              <Select
                label="Assign this product to"
                options={vendors.map((v) => ({
                  label: `${v.name} (${v.email})`,
                  value: v.id,
                }))}
                value={vendorId}
                onChange={setVendorId}
              />
            </BlockStack>
          </Card>

          {method === "choose" && (
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">
                  How do you want to add a product?
                </Text>
                <Text as="p" variant="bodyLg" tone="subdued">
                  Same as the seller portal — photo first or type it in.
                </Text>
                <Button
                  variant="primary"
                  size="large"
                  fullWidth
                  onClick={() => setMethod("easy")}
                >
                  1. Photo first (easy)
                </Button>
                <Text as="p" tone="subdued">
                  Take a photo, then type the name and price.
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
                correct, tap Publish product.
              </Banner>

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
                          Seller
                        </Text>
                        <Text as="p" variant="headingMd">
                          {selectedVendor?.name || "—"}
                        </Text>
                      </div>
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
                      {aiCustomizationFee.trim() ? (
                        <div>
                          <Text as="p" tone="subdued" variant="bodyMd">
                            AI customization fee
                          </Text>
                          <Text as="p" variant="headingMd">
                            ₱{aiCustomizationFee}
                          </Text>
                        </div>
                      ) : null}
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
                    Looks good — Publish product
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
                First take a photo, then type the name and price. You will see a
                preview before saving.
              </Text>

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

              <Step
                number={2}
                title="Product name"
                hint='Example: "Red inabel scarf"'
                locked={!hasPhoto}
              >
                <TextField
                  label="Name"
                  value={title}
                  onChange={setTitle}
                  autoComplete="off"
                  placeholder="Red inabel scarf"
                  disabled={!hasPhoto}
                  helpText={title ? "✓ Name ready" : "Type the product name"}
                />
              </Step>

              <Step
                number={3}
                title="Price"
                hint='Type the price, like "250".'
                locked={!hasPhoto}
              >
                <TextField
                  label="Price"
                  type="text"
                  inputMode="decimal"
                  value={price}
                  onChange={onPriceChange}
                  autoComplete="off"
                  prefix="₱"
                  placeholder="250"
                  disabled={!hasPhoto}
                  helpText={price ? "✓ Price ready" : "Type the price"}
                />
              </Step>

              <Step
                number={4}
                title="AI customization fee (optional)"
                hint="Extra fee for AI customization. Leave blank if none."
                locked={!hasPhoto}
              >
                <TextField
                  label="AI customization fee"
                  type="text"
                  inputMode="decimal"
                  value={aiCustomizationFee}
                  onChange={onAiFeeChange}
                  autoComplete="off"
                  prefix="₱"
                  placeholder="0.00"
                  disabled={!hasPhoto}
                  helpText="Optional. Example: 50 or 50.00"
                />
              </Step>

              <Step
                number={5}
                title="Shop location quantity (optional)"
                hint="How many pieces are ready at the shop location. Type or use + and −. If you skip, we use 1."
                locked={!hasPhoto}
              >
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
              </Step>

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
                      label="About this product"
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
                        : "Then type a name and price"}
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
                title="AI customization fee (optional)"
                hint="Extra fee for AI customization. Leave blank if none."
              >
                <TextField
                  label="AI customization fee"
                  labelHidden
                  type="text"
                  inputMode="decimal"
                  value={aiCustomizationFee}
                  onChange={onAiFeeChange}
                  autoComplete="off"
                  prefix="₱"
                  placeholder="0.00"
                />
              </Step>

              <Step
                number={4}
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
                number={5}
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
                number={6}
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

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
