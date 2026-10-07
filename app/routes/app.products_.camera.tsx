import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Page,
  Text,
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return {};
};

/**
 * Top-level camera page for admin add-product.
 * Shopify Admin iframes block getUserMedia; a popup can request the camera.
 */
export default function AdminProductCameraCapture() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser cannot open the camera. Close this window and use Choose from gallery.");
        setStarting(false);
        return;
      }

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
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: "user",
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          });
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setReady(true);
        setStarting(false);
      } catch {
        if (!cancelled) {
          setError(
            "Could not open the camera. Allow camera permission for this site, then reload.",
          );
          setStarting(false);
        }
      }
    }

    void start();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [stopCamera]);

  const takePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setError("Camera is still starting. Wait a second, then try again.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: "marketplace-camera-capture", dataUrl },
        window.location.origin,
      );
    }
    stopCamera();
    window.close();
  }, [stopCamera]);

  return (
    <Page title="Take a product photo">
      <BlockStack gap="400">
        <Text as="p" tone="subdued">
          This window can use your camera because it is outside Shopify Admin.
        </Text>
        {error ? <Banner tone="critical">{error}</Banner> : null}
        <Card>
          <BlockStack gap="300">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: "100%",
                maxHeight: 480,
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
              loading={starting}
              disabled={!ready || Boolean(error)}
              onClick={takePhoto}
            >
              Take photo
            </Button>
            <Button
              size="large"
              fullWidth
              onClick={() => {
                stopCamera();
                window.close();
              }}
            >
              Cancel
            </Button>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  const headers = boundary.headers(headersArgs);
  headers.set("Permissions-Policy", "camera=(self)");
  return headers;
};
