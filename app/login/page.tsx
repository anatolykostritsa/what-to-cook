import AuthForm from "@/components/AuthForm";

export default function LoginPage() {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="logo">🍳</div>

        <h1>What to Cook?</h1>

        <p className="subtitle">
          Общая кухня для вас двоих
        </p>

        <AuthForm />
      </div>
    </main>
  );
}