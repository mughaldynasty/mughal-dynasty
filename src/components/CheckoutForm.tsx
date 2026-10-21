import React, { useState, useEffect } from 'react';
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface CheckoutFormProps {
  amount: number;
  onSuccess: (paymentIntentId: string) => void;
  onCancel: () => void;
}

export default function CheckoutForm({ amount, onSuccess, onCancel }: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) return;

    setIsProcessing(true);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      confirmParams: {
        return_url: `${window.location.origin}${window.location.pathname}?payment_success=true`,
      },
    });

    if (error) {
      setMessage(error.message || 'An unexpected error occurred.');
      toast.error(error.message || 'Payment failed');
    } else if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing')) {
      onSuccess(paymentIntent.id);
    }

    setIsProcessing(false);
  };

  return (
    <form id="payment-form" onSubmit={handleSubmit} className="space-y-6 max-w-md mx-auto px-1 sm:px-0">
      <div className="bg-white/5 rounded-2xl p-4 sm:p-6 border border-white/10 shadow-2xl">
        <PaymentElement 
          id="payment-element" 
          options={{ 
            layout: 'tabs',
            defaultValues: {
              billingDetails: {
                name: '',
              }
            },
            wallets: {
              applePay: 'auto',
              googlePay: 'auto',
            },
            // Disable Link (one-click checkout) as requested
            link: {
              email: 'disabled'
            },
            paymentMethodOrder: ['apple_pay', 'google_pay', 'card'],
          }} 
        />
      </div>
      
      {message && (
        <div className="text-red-500 text-[11px] sm:text-xs bg-red-500/10 p-3 rounded-xl border border-red-500/20">
          {message}
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isProcessing}
          className="w-full sm:w-1/3 py-4 bg-white/5 border border-white/10 rounded-2xl font-bold text-xs sm:text-sm tracking-widest uppercase hover:bg-white/10 transition-all disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={isProcessing || !stripe || !elements}
          id="submit"
          className="w-full sm:flex-1 py-4 bg-orange-600 text-white rounded-2xl font-black text-xs sm:text-sm tracking-widest uppercase hover:bg-orange-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-600/20 disabled:opacity-50"
        >
          {isProcessing ? (
            <>
              <Loader2 className="animate-spin" size={18} />
              PROCESSING...
            </>
          ) : (
            `PAY £${amount.toFixed(2)}`
          )}
        </button>
      </div>
      
      <p className="text-[10px] text-gray-500 text-center uppercase tracking-widest font-bold">
        Secure encryption by Stripe
      </p>
    </form>
  );
}
