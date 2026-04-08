import React, { useState, useEffect, useRef } from "react";
import { createPaymentT3, verifyPaymentT3, applyCoupon } from "@/services/drMamataPaymentService";
import { useLocation, useNavigate } from "react-router-dom";

// Inject spinner CSS once
if (!document.getElementById("rzp-spinner-style")) {
  const s = document.createElement("style");
  s.id = "rzp-spinner-style";
  s.textContent = `@keyframes rzp-spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(s);
}

const loadRazorpay = () =>
  new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });

const Checkout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const hasTriggered = useRef(false);

  const [organizationData, setOrganizationData] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState("Loading checkout...");
  const [dataReady, setDataReady] = useState(false);

  const [coupon, setCoupon] = useState("");
  const [discountPercent, setDiscountPercent] = useState(0);
  const [couponApplied, setCouponApplied] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    country: "India",
  });

  // ─── 1. Load data from navigation state or sessionStorage ─────────────────
  useEffect(() => {
    let orgData = null;
    let planData = null;

    if (location.state?.organizationData && location.state?.selectedPlan) {
      orgData = location.state.organizationData;
      planData = location.state.selectedPlan;
    } else {
      try {
        const stored = sessionStorage.getItem("checkoutData");
        if (stored) {
          const parsed = JSON.parse(stored);
          orgData = parsed.organizationData;
          planData = parsed.selectedPlan;
        }
      } catch (e) {
        console.error("Failed to parse checkoutData:", e);
      }
    }

    console.log("📋 orgData:", orgData);
    console.log("📋 planData:", planData);

    if (!orgData || !planData) {
      setStatusMsg("No checkout data found. Redirecting...");
      setTimeout(() => navigate("/onboarding"), 1500);
      return;
    }

    // ── Resolve price from whatever field the plan uses ─────────────────────
    const resolvedPrice = Number(
      planData.price ??
      planData.monthlyPrice ??
      planData.yearlyPrice ??
      planData.amount ??
      0
    );

    console.log("💰 Resolved price:", resolvedPrice);

    if (resolvedPrice <= 0) {
      console.error("❌ Plan price is 0 or missing. planData:", planData);
      setStatusMsg("❌ Could not determine plan price. Please go back and try again.");
      return;
    }

    // Normalise plan so price is always in plan.price
    const normalisedPlan = { ...planData, price: resolvedPrice };

    setOrganizationData(orgData);
    setSelectedPlan(normalisedPlan);
    setFormData((prev) => ({
      ...prev,
      name: orgData?.name || "",
      email: orgData?.email || "",
      phone: orgData?.phone || orgData?.mobile || "",
    }));
    setDataReady(true);
  }, []);

  // ─── 2. Auto-trigger Razorpay once data is confirmed ready ────────────────
  useEffect(() => {
    if (dataReady && selectedPlan && !hasTriggered.current) {
      hasTriggered.current = true;
      // Pass plan directly — don't rely on closure over state
      triggerRazorpay(selectedPlan, organizationData, formData, discountPercent, coupon);
    }
  }, [dataReady, selectedPlan]);

  // ─── Core payment trigger ─────────────────────────────────────────────────
  // Accepts all values as arguments so it never reads stale state
  const triggerRazorpay = async (plan, orgData, contact, discount, couponCode) => {
    setIsProcessing(true);
    setStatusMsg("Initializing payment gateway...");

    const sdkLoaded = await loadRazorpay();
    if (!sdkLoaded) {
      setStatusMsg("❌ Razorpay SDK failed to load. Check your connection.");
      setIsProcessing(false);
      return;
    }

    const basePrice = Number(plan.price);
    const finalAmount = basePrice - (basePrice * discount) / 100;

    const payload = {
      name: contact.name || orgData?.name || "",
      mobile: contact.phone || "",
      email: contact.email || "",
      country: contact.country || "India",
      plan_name: plan.name || "Plan",
      amount: finalAmount.toString(),           // ← always a real number now
      organization_name: orgData?.name || "",
      coupon_code: discount > 0 ? couponCode : null,
    };

    console.log("🔵 createPaymentT3 payload:", payload);
    setStatusMsg("Creating order...");

    try {
      const data = await createPaymentT3(payload);
      console.log("🟢 createPaymentT3 response:", data);

      if (!data?.success) {
        throw new Error(data?.message || "Backend failed to create payment order");
      }

      if (!data.key || !data.order_id || !data.amount) {
        console.error("❌ Missing fields in response:", data);
        throw new Error("Incomplete response from payment server (missing key/order_id/amount)");
      }

      console.log("🚀 Opening Razorpay | key:", data.key, "| order_id:", data.order_id, "| amount:", data.amount);

      const options = {
        key: data.key,
        amount: data.amount,
        currency: data.currency || "INR",
        name: "Dr Mamata Jain",
        description: plan.name || "Plan Purchase",
        order_id: data.order_id,

        // handler: async function (response) {
        //   console.log("🟢 Payment success:", response);
        //   setStatusMsg("Verifying payment...");
        //   try {
        //     const verifyData = await verifyPaymentT3({
        //       razorpay_order_id: response.razorpay_order_id,
        //       razorpay_payment_id: response.razorpay_payment_id,
        //       razorpay_signature: response.razorpay_signature,
        //       gateway: "razorpay",
        //     });

        //     console.log("🟢 verifyPaymentT3 response:", verifyData);

        //     if (!verifyData?.success) {
        //       throw new Error(verifyData?.message || "Payment verification failed");
        //     }

        //     sessionStorage.removeItem("checkoutData");
        //     window.location.href = "/success";
        //   } catch (err) {
        //     console.error("❌ Verification error:", err);
        //     setStatusMsg(`❌ ${err.message}`);
        //     setIsProcessing(false);
        //   }
        // },
handler: async function (response) {
  console.log("🟢 Payment success:", response);
  setStatusMsg("Verifying payment...");

  try {
    // ✅ 1. VERIFY PAYMENT (already correct)
    const verifyData = await verifyPaymentT3({
      razorpay_order_id: response.razorpay_order_id,
      razorpay_payment_id: response.razorpay_payment_id,
      razorpay_signature: response.razorpay_signature,
      gateway: "razorpay",
    });

    console.log("🟢 verifyPaymentT3 response:", verifyData);

    if (!verifyData?.success) {
      throw new Error(verifyData?.message || "Payment verification failed");
    }

    // 🔥 2. STORE IN YOUR DATABASE (ADD THIS)
    setStatusMsg("Creating organization...");

    const checkoutData = JSON.parse(sessionStorage.getItem("checkoutData"));

    const saveRes = await fetch(`${import.meta.env.VITE_API_URL}/payments/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: checkoutData.user._id,
        selectedPlan: checkoutData.selectedPlan,
        organizationData: checkoutData.organizationData,

        razorpay_order_id: response.razorpay_order_id,
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_signature: response.razorpay_signature,
      }),
    });

    const saveData = await saveRes.json();

    if (!saveData.success) {
      throw new Error("Failed to save payment/org");
    }

    // ✅ 3. CLEANUP + REDIRECT
    sessionStorage.removeItem("checkoutData");

    window.location.href = "/success";

  } catch (err) {
    console.error("❌ Verification error:", err);
    setStatusMsg(`❌ ${err.message}`);
    setIsProcessing(false);
  }
},
        modal: {
          ondismiss: function () {
            console.log("ℹ️ Razorpay modal dismissed");
            setIsProcessing(false);
            hasTriggered.current = false;
            setStatusMsg("Payment cancelled. Update details below and retry.");
          },
        },

        prefill: {
          name: contact.name || orgData?.name || "",
          email: contact.email || "",
          contact: contact.phone || "",
        },

        theme: { color: "#3399cc" },
      };

      const rzp = new window.Razorpay(options);
      rzp.on("payment.failed", (response) => {
        console.error("❌ payment.failed:", response.error);
        setStatusMsg(`❌ Payment failed: ${response.error.description}`);
        setIsProcessing(false);
        hasTriggered.current = false;
      });

      rzp.open();
      setStatusMsg("");
    } catch (err) {
      console.error("❌ Payment error:", err);
      setStatusMsg(`❌ ${err.message || "Something went wrong. Please retry."}`);
      setIsProcessing(false);
      hasTriggered.current = false;
    }
  };

  const handleApplyCoupon = async () => {
    if (!coupon) return alert("Enter a coupon code");
    const res = await applyCoupon({
      coupon_code: coupon,
      email: formData.email,
      mobile: formData.phone,
    });
    if (res.success) {
      setDiscountPercent(res.discount || 10);
      setCouponApplied(true);
      alert("Coupon applied!");
    } else {
      alert("Invalid coupon");
    }
  };

  const handleChange = (e) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const basePrice = selectedPlan?.price || 0;
  const finalDisplay = basePrice - (basePrice * discountPercent) / 100;

  // ─── Full-screen loader ───────────────────────────────────────────────────
  if (!dataReady || isProcessing) {
    return (
      <div style={loaderWrap}>
        <div style={spinnerStyle} />
        <p style={{ marginTop: "20px", color: "#555", fontSize: "15px", textAlign: "center", maxWidth: "300px" }}>
          {statusMsg}
        </p>
      </div>
    );
  }

  // ─── Fallback UI (shown only if modal was dismissed or error) ─────────────
  return (
    <div style={{ maxWidth: "520px", margin: "auto", padding: "32px 20px" }}>
      <h2 style={{ marginBottom: "8px" }}>Complete Your Purchase</h2>

      {statusMsg && (
        <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: "8px", padding: "12px 16px", marginBottom: "20px", color: "#92400e" }}>
          {statusMsg}
        </div>
      )}

      {/* Plan summary */}
      <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "8px", padding: "16px", marginBottom: "24px" }}>
        <p style={{ margin: 0, fontWeight: 600 }}>{selectedPlan?.name}</p>
        <p style={{ margin: "4px 0 0", color: "#555" }}>
          ₹{basePrice}
          {discountPercent > 0 && <span style={{ color: "#16a34a", marginLeft: "8px" }}>— {discountPercent}% off</span>}
        </p>
        {discountPercent > 0 && (
          <p style={{ margin: "4px 0 0", fontWeight: 700, fontSize: "18px" }}>Total: ₹{finalDisplay}</p>
        )}
      </div>

      {/* Contact fields */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <input name="name" placeholder="Full Name *" value={formData.name} onChange={handleChange} style={inputStyle} />
        <input name="email" type="email" placeholder="Email *" value={formData.email} onChange={handleChange} style={inputStyle} />
        <input name="phone" type="tel" placeholder="Phone *" value={formData.phone} onChange={handleChange} style={inputStyle} />
      </div>

      {/* Coupon */}
      <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
        <input
          placeholder="Coupon Code"
          value={coupon}
          onChange={(e) => setCoupon(e.target.value)}
          disabled={couponApplied}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          onClick={handleApplyCoupon}
          disabled={couponApplied}
          style={{ padding: "10px 16px", background: couponApplied ? "#d1fae5" : "#0ea5e9", color: couponApplied ? "#15803d" : "#fff", border: "none", borderRadius: "6px", cursor: couponApplied ? "default" : "pointer", fontWeight: 600 }}
        >
          {couponApplied ? "✓ Applied" : "Apply"}
        </button>
      </div>

      {/* Retry button */}
      <button
        onClick={() => {
          hasTriggered.current = false;
          triggerRazorpay(selectedPlan, organizationData, formData, discountPercent, coupon);
        }}
        style={{ marginTop: "24px", width: "100%", padding: "14px", background: "#3399cc", color: "#fff", border: "none", borderRadius: "8px", fontSize: "16px", fontWeight: 700, cursor: "pointer" }}
      >
        Pay ₹{finalDisplay}
      </button>

      <p style={{ textAlign: "center", marginTop: "12px", fontSize: "13px", color: "#888" }}>
        Secured by Razorpay
      </p>
    </div>
  );
};

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  fontSize: "14px",
  boxSizing: "border-box",
};

const loaderWrap = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "100vh",
};

const spinnerStyle = {
  width: "44px",
  height: "44px",
  border: "4px solid #e2e8f0",
  borderTop: "4px solid #3399cc",
  borderRadius: "50%",
  animation: "rzp-spin 0.8s linear infinite",
};

export default Checkout;