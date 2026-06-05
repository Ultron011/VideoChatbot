import { useEffect, useState, useRef } from 'react';
import {
  Phone,
  Video,
  Mic,
  Heart,
  Star,
  Clock,
  Globe,
  Shield,
} from 'lucide-react';
import './landing.css';

type LandingPageProps = {
  onStartCall: () => void;
};

export function LandingPage({ onStartCall }: LandingPageProps) {
  // Navigation frosted glass on scroll
  const [isScrolled, setIsScrolled] = useState(false);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (e.currentTarget.scrollTop > 20) {
      setIsScrolled(true);
    } else {
      setIsScrolled(false);
    }
  };

  // Twinkling stars particle creation
  const [stars] = useState(() =>
    Array.from({ length: 45 }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      top: `${Math.random() * 100}%`,
      size: Math.random() * 2.5 + 0.5,
      delay: `${Math.random() * 8}s`,
      duration: `${Math.random() * 6 + 4}s`,
    }))
  );

  // Parallax effect on mouse move in Hero section
  const heroRef = useRef<HTMLDivElement>(null);
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const hero = heroRef.current;
    if (!hero) return;
    const { clientX, clientY } = e;
    const { width, height, left, top } = hero.getBoundingClientRect();
    const x = (clientX - left) / width - 0.5;
    const y = (clientY - top) / height - 0.5;
    hero.style.setProperty('--mouse-x', x.toFixed(3));
    hero.style.setProperty('--mouse-y', y.toFixed(3));
  };

  const handleMouseLeave = () => {
    const hero = heroRef.current;
    if (!hero) return;
    hero.style.setProperty('--mouse-x', '0');
    hero.style.setProperty('--mouse-y', '0');
  };

  // Fade-in elements on scroll using IntersectionObserver
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
          }
        });
      },
      { threshold: 0.1 }
    );

    const hiddenElements = document.querySelectorAll('.fade-in-section');
    hiddenElements.forEach((el) => observer.observe(el));

    return () => {
      hiddenElements.forEach((el) => observer.unobserve(el));
    };
  }, []);

  // Smooth scroll helper
  const scrollToHowItWorks = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const section = document.getElementById('how-it-works');
    if (section) {
      section.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="landing-wrapper" onScroll={handleScroll}>
      <nav className={`landing-nav ${isScrolled ? 'scrolled' : ''}`}>
        <a href="#" className="nav-brand" aria-label="Dr. Malpani AI Twin Home">
          <svg className="nav-brand-logo" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="22" height="22">
            <defs>
              <linearGradient id="logoGoldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#fbf3db" />
                <stop offset="50%" stopColor="#c5a880" />
                <stop offset="100%" stopColor="#866c4c" />
              </linearGradient>
            </defs>
            <path d="M12 2a5 5 0 00-5 5c0 2.8 2.2 5 5 5s5-2.2 5-5a5 5 0 00-5-5z" stroke="url(#logoGoldGrad)" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M12 7c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" stroke="var(--accent-green)" strokeWidth="1.5" strokeLinecap="round" opacity="0.85" />
            <path d="M12 12c-2.8 0-5 2.2-5 5a1 1 0 002 0c0-1.7 1.3-3 3-3s3 1.3 3 3a1 1 0 002 0c0-2.8-2.2-5-5-5z" stroke="url(#logoGoldGrad)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="nav-brand-main">
            Dr. Malpani <span className="nav-brand-highlight">AI Twin</span>
          </span>
        </a>
        <button className="btn-pill btn-green header-cta-btn" onClick={onStartCall} aria-label="Start Free Consultation">
          <Phone size={14} />
          <span className="nav-cta-text">Start Free Consultation</span>
        </button>
      </nav>

      {/* 2. HERO SECTION */}
      <header
        ref={heroRef}
        className="landing-hero"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Animated Twinkling Star Particles */}
        <div className="landing-stars">
          {stars.map((star) => (
            <div
              key={star.id}
              className="landing-star"
              style={{
                left: star.left,
                top: star.top,
                width: `${star.size}px`,
                height: `${star.size}px`,
                animationDelay: star.delay,
                animationDuration: star.duration,
              }}
            />
          ))}
        </div>

        {/* Floating geometric 3D SVG shapes */}
        <div className="landing-shapes">
          <div className="landing-shape shape-octahedron">
            <svg viewBox="0 0 200 200" width="200" height="200" fill="none">
              <defs>
                <linearGradient id="platGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="50%" stopColor="#a3a3a3" />
                  <stop offset="100%" stopColor="#404040" />
                </linearGradient>
              </defs>
              <line x1="100" y1="20" x2="40" y2="100" stroke="url(#platGrad)" strokeWidth="1.2" />
              <line x1="100" y1="20" x2="160" y2="100" stroke="url(#platGrad)" strokeWidth="1.2" />
              <line x1="100" y1="20" x2="100" y2="100" stroke="url(#platGrad)" strokeWidth="0.8" opacity="0.6" />
              <polygon points="40,100 100,80 160,100 100,120" stroke="url(#platGrad)" strokeWidth="1" strokeLinejoin="round" />
              <line x1="100" y1="180" x2="40" y2="100" stroke="url(#platGrad)" strokeWidth="1.2" />
              <line x1="100" y1="180" x2="160" y2="100" stroke="url(#platGrad)" strokeWidth="1.2" />
              <line x1="100" y1="180" x2="100" y2="100" stroke="url(#platGrad)" strokeWidth="0.8" opacity="0.6" />
            </svg>
          </div>

          <div className="landing-shape shape-rings">
            <svg viewBox="0 0 200 200" width="160" height="160" fill="none">
              <defs>
                <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#fbf3db" />
                  <stop offset="50%" stopColor="#c5a880" />
                  <stop offset="100%" stopColor="#866c4c" />
                </linearGradient>
              </defs>
              <ellipse cx="100" cy="100" rx="80" ry="30" stroke="url(#goldGrad)" strokeWidth="1.2" />
              <ellipse cx="100" cy="100" rx="60" ry="22" stroke="url(#goldGrad)" strokeWidth="1" strokeDasharray="5 3" opacity="0.7" />
              <ellipse cx="100" cy="100" rx="40" ry="15" stroke="url(#goldGrad)" strokeWidth="0.6" opacity="0.4" />
            </svg>
          </div>

          <div className="landing-shape shape-sphere">
            <svg viewBox="0 0 200 200" width="120" height="120" fill="none">
              <defs>
                <linearGradient id="goldGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#fbf3db" />
                  <stop offset="50%" stopColor="#c5a880" />
                  <stop offset="100%" stopColor="#866c4c" />
                </linearGradient>
              </defs>
              <circle cx="100" cy="100" r="70" stroke="url(#goldGrad2)" strokeWidth="0.8" transform="rotate(30, 100, 100)" />
              <circle cx="100" cy="100" r="70" stroke="url(#goldGrad2)" strokeWidth="0.8" transform="rotate(-30, 100, 100)" strokeDasharray="8 4" opacity="0.7" />
              <circle cx="100" cy="100" r="70" stroke="url(#goldGrad2)" strokeWidth="0.5" transform="rotate(90, 100, 100)" opacity="0.4" />
            </svg>
          </div>

          <div className="landing-shape shape-helix">
            <svg viewBox="0 0 100 200" width="80" height="160" fill="none">
              <defs>
                <linearGradient id="platHelix" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#ffffff" opacity="0.8" />
                  <stop offset="50%" stopColor="#a3a3a3" opacity="0.4" />
                  <stop offset="100%" stopColor="#404040" opacity="0.1" />
                </linearGradient>
              </defs>
              <path d="M50,10 C20,40 80,70 50,100 C20,130 80,160 50,190" stroke="url(#platHelix)" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M50,10 C80,40 20,70 50,100 C80,130 20,160 50,190" stroke="url(#platHelix)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.5" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        <div className="hero-container">
          <div className="hero-content">
            <div className="hero-eyebrow">
              <SparklesIcon />
              <span>AI-Powered IVF Query Assistant</span>
            </div>
            <h1 className="hero-h1">
              Meet Dr. Malpani's <br className="hero-br" />
              <span className="hero-h1-highlight">AI Twin</span>
            </h1>
            <div className="hero-text-group">
              <p className="hero-lead">
                Have a live, face-to-face video chat with an AI trained on Dr. Malpani's decades of IVF experience. Get your fertility queries resolved instantly and privately before speaking with a doctor.
              </p>
              
              <div className="hero-mini-badges">
                <span className="mini-badge-item">Face-to-Face Video</span>
                <span className="mini-badge-sep">•</span>
                <span className="mini-badge-item">Available 24/7</span>
                <span className="mini-badge-sep">•</span>
                <span className="mini-badge-item">100% Private</span>
              </div>
            </div>
            <div className="hero-ctas">
              <button className="btn-pill btn-green btn-large hero-primary-btn" onClick={onStartCall} aria-label="Start Your Consultation">
                <Video size={16} />
                <span>Start Your Chat</span>
              </button>
              <button
                className="btn-pill btn-ghost btn-large hero-secondary-btn"
                onClick={scrollToHowItWorks}
                aria-label="See How It Works"
              >
                <span>See How It Works →</span>
              </button>
            </div>
          </div>

          <div className="hero-visual">
            <div className="call-preview-card" onClick={onStartCall} role="button" tabIndex={0} aria-label="Start your consultation">
              {/* Status Pill — matches real StatusPill */}
              <div className="preview-status-pill">
                <div className="preview-pulse-dot" />
                <span>AI Twin Ready</span>
              </div>

              {/* User PiP — matches real user-pip */}
              <div className="preview-pip">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M18 21a6 6 0 0 0-12 0" />
                  <circle cx="12" cy="10" r="4" />
                </svg>
              </div>

              {/* Central Avatar: Facial Wireframe */}
              <div className="preview-avatar-area">
                <div className="preview-ring ring-1" />
                <div className="preview-ring ring-2" />
                <svg className="preview-face-svg" viewBox="0 0 200 200" fill="none">
                  <defs>
                    <linearGradient id="faceGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#fbf3db" stopOpacity="0.7" />
                      <stop offset="50%" stopColor="#c5a880" stopOpacity="0.35" />
                      <stop offset="100%" stopColor="#866c4c" stopOpacity="0.08" />
                    </linearGradient>
                    <radialGradient id="faceGlow" cx="50%" cy="45%" r="45%">
                      <stop offset="0%" stopColor="#c5a880" stopOpacity="0.2" />
                      <stop offset="100%" stopColor="transparent" />
                    </radialGradient>
                  </defs>
                  <circle cx="100" cy="90" r="50" fill="url(#faceGlow)" />
                  <path d="M100 38 C78 38 64 52 64 74 C64 88 67 96 70 101 C72 104 73 108 73 113 C73 119 77 124 84 127 C86 128 88 132 89 135 L91 140 C93 144 96 146 100 146 C104 146 107 144 109 140 L111 135 C112 132 114 128 116 127 C123 124 127 119 127 113 C127 108 128 104 130 101 C133 96 136 88 136 74 C136 52 122 38 100 38Z" fill="url(#faceGrad)" stroke="url(#logoGoldGrad)" strokeWidth="1" />
                  {/* Scan lines */}
                  <path d="M66 68 C78 64 122 64 134 68" stroke="var(--gold-mid)" strokeWidth="0.6" opacity="0.3" />
                  <path d="M64 82 C78 78 122 78 136 82" stroke="var(--gold-mid)" strokeWidth="0.6" opacity="0.4" />
                  <path d="M67 96 C78 91 122 91 133 96" stroke="var(--gold-mid)" strokeWidth="0.6" opacity="0.3" />
                  <path d="M100 38 C100 60 100 100 100 146" stroke="var(--gold-mid)" strokeWidth="0.7" opacity="0.5" />
                  {/* Landmark nodes */}
                  <circle cx="82" cy="70" r="2" fill="#fff" stroke="var(--accent-green)" strokeWidth="1.2" className="glow-node" />
                  <circle cx="118" cy="70" r="2" fill="#fff" stroke="var(--accent-green)" strokeWidth="1.2" className="glow-node" />
                  <circle cx="100" cy="82" r="2" fill="#fff" stroke="var(--gold-mid)" strokeWidth="1.2" className="glow-node" />
                  <circle cx="100" cy="112" r="2.5" fill="#fff" stroke="var(--accent-green)" strokeWidth="1.2" className="glow-node" />
                </svg>
              </div>

              {/* Controls Bar — matches real controls-bar */}
              <div className="preview-controls">
                <div className="preview-ctrl-btn">
                  <Mic size={14} />
                </div>
                <div className="preview-ctrl-btn">
                  <Video size={14} />
                </div>
                <div className="preview-ctrl-btn preview-ctrl-end">
                  <Phone size={14} />
                </div>
              </div>

              {/* Tap to start overlay hint */}
              <div className="preview-tap-hint">
                <span>Tap to start your chat</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* 3. TRUST BAR */}
      <section className="landing-trust">
        <div className="trust-container">
          <div className="trust-marquee">
            <div className="trust-marquee-track">
              {/* First Set of Items */}
              <div className="trust-item">
                <div className="trust-icon"><Star size={14} fill="currentColor" /></div>
                <span className="trust-label">30+ Years of IVF Expertise</span>
              </div>
              <div className="trust-item">
                <div className="trust-icon"><Heart size={14} fill="currentColor" /></div>
                <span className="trust-label">10,000+ Babies Born</span>
              </div>
              <div className="trust-item">
                <div className="trust-icon"><Clock size={14} /></div>
                <span className="trust-label">Available 24/7/365</span>
              </div>
              <div className="trust-item">
                <div className="trust-icon"><Globe size={14} /></div>
                <span className="trust-label">Multilingual Support</span>
              </div>
              <div className="trust-item">
                <div className="trust-icon"><Shield size={14} /></div>
                <span className="trust-label">100% Free & Private</span>
              </div>
              
              {/* Duplicated Set for Infinite Loop */}
              <div className="trust-item">
                <div className="trust-icon"><Star size={14} fill="currentColor" /></div>
                <span className="trust-label">30+ Years of IVF Expertise</span>
              </div>
              <div className="trust-item">
                <div className="trust-icon"><Heart size={14} fill="currentColor" /></div>
                <span className="trust-label">10,000+ Babies Born</span>
              </div>
              <div className="trust-item">
                <div className="trust-icon"><Clock size={14} /></div>
                <span className="trust-label">Available 24/7/365</span>
              </div>
              <div className="trust-item">
                <div className="trust-icon"><Globe size={14} /></div>
                <span className="trust-label">Multilingual Support</span>
              </div>
              <div className="trust-item">
                <div className="trust-icon"><Shield size={14} /></div>
                <span className="trust-label">100% Free & Private</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. HOW IT WORKS */}
      <section id="how-it-works" className="landing-section fade-in-section">
        <div className="section-header">
          <h2 className="section-h2">How Your AI Chat Works</h2>
          <p className="section-p">
            Resolving your IVF and fertility queries is simple, direct, and completely free. Here is how you can talk to the AI Twin on any device.
          </p>
        </div>

        <div className="scroll-snap-slider">
          <div className="how-card snap-slide">
            <span className="card-num">01</span>
            <div className="card-icon-wrap">
              <Phone size={20} />
            </div>
            <h3 className="card-title">Click 'Start Your Chat'</h3>
            <p className="card-body">
              No registration or sign-up needed. Open on any mobile device, tablet, or desktop instantly to begin your session.
            </p>
          </div>

          <div className="how-card snap-slide">
            <span className="card-num">02</span>
            <div className="card-icon-wrap">
              <Mic size={20} />
            </div>
            <h3 className="card-title">Talk to the AI Twin</h3>
            <p className="card-body">
              Have a natural, live face-to-face conversation. Ask anything about IVF treatments, timelines, medications, or explain your reports.
            </p>
          </div>

          <div className="how-card snap-slide">
            <span className="card-num">03</span>
            <div className="card-icon-wrap">
              <Heart size={20} />
            </div>
            <h3 className="card-title">Get Expert Guidance</h3>
            <p className="card-body">
              Receive tailored next steps and plain-language summaries to prepare you perfectly for your actual consultation with Dr. Malpani.
            </p>
          </div>
        </div>
      </section>

      {/* 5. WHAT YOU CAN ASK */}
      <section className="landing-section fade-in-section">
        <div className="section-header">
          <h2 className="section-h2">What Can You Ask?</h2>
          <p className="section-p">
            The AI Twin is fully trained on Dr. Malpani's extensive medical literature, books, and articles. Ask any question with total privacy.
          </p>
        </div>

        <div className="chips-marquee-container">
          {/* Row 1 Ticker (Scrolls Left) */}
          <div className="chips-marquee marquee-left">
            <div className="chips-track">
              {/* Row 1 Chips */}
              <div className="chip-card">
                <div className="chip-dot" />
                <span className="chip-label">IVF Process & Timeline</span>
              </div>
              <div className="chip-card">
                <div className="chip-dot" />
                <span className="chip-label">Your Test Results Explained</span>
              </div>
              <div className="chip-card">
                <div className="chip-dot" />
                <span className="chip-label">Success Rate Factors</span>
              </div>
              <div className="chip-card">
                <div className="chip-dot" />
                <span className="chip-label">Egg Freezing Options</span>
              </div>
              
              {/* Duplicated Row 1 Chips for Seamless Loop */}
              <div className="chip-card">
                <div className="chip-dot" />
                <span className="chip-label">IVF Process & Timeline</span>
              </div>
              <div className="chip-card">
                <div className="chip-dot" />
                <span className="chip-label">Your Test Results Explained</span>
              </div>
              <div className="chip-card">
                <div className="chip-dot" />
                <span className="chip-label">Success Rate Factors</span>
              </div>
              <div className="chip-card">
                <div className="chip-dot" />
                <span className="chip-label">Egg Freezing Options</span>
              </div>
            </div>
          </div>

          {/* Row 2 Ticker (Scrolls Right) */}
          <div className="chips-marquee marquee-right">
            <div className="chips-track">
              {/* Row 2 Chips */}
              <div className="chip-card">
                <div className="chip-dot" />
                <span className="chip-label">Cost & Treatment Budgets</span>
              </div>
              <div className="chip-card">
                <div className="chip-dot" />
                <span className="chip-label">Emotional & Stress Support</span>
              </div>
              <div className="chip-card">
                <div className="chip-dot" />
                <span className="chip-label">Second Opinion on IVF Cycles</span>
              </div>
              <div className="chip-card">
                <div className="chip-dot" />
                <span className="chip-label">Treatment Alternatives</span>
              </div>
              
              {/* Duplicated Row 2 Chips for Seamless Loop */}
              <div className="chip-card">
                <div className="chip-dot" />
                <span className="chip-label">Cost & Treatment Budgets</span>
              </div>
              <div className="chip-card">
                <div className="chip-dot" />
                <span className="chip-label">Emotional & Stress Support</span>
              </div>
              <div className="chip-card">
                <div className="chip-dot" />
                <span className="chip-label">Second Opinion on IVF Cycles</span>
              </div>
              <div className="chip-card">
                <div className="chip-dot" />
                <span className="chip-label">Treatment Alternatives</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. TESTIMONIALS */}
      <section className="landing-section fade-in-section">
        <div className="section-header">
          <h2 className="section-h2">What Patients Are Saying</h2>
          <p className="section-p">
            Real couples who used the AI Twin to resolve their queries and find hope in their fertility journeys.
          </p>
        </div>

        <div className="scroll-snap-slider">
          <div className="testimonial-card snap-slide">
            <div className="quote-icon">
              <QuoteIcon />
            </div>
            <div className="star-rating" aria-label="5 star rating">
              {[...Array(5)].map((_, i) => (
                <Star key={i} size={14} fill="currentColor" />
              ))}
            </div>
            <p className="quote-text">
              "I was extremely nervous about our first IVF cycle and didn't know what to expect. The AI Twin answered all my questions patiently at midnight. It genuinely felt like talking to a warm, empathetic doctor."
            </p>
            <div className="author-info">
              <span className="author-name">Priya S.</span>
              <span className="author-meta">Mumbai</span>
            </div>
          </div>

          <div className="testimonial-card snap-slide">
            <div className="quote-icon">
              <QuoteIcon />
            </div>
            <div className="star-rating" aria-label="5 star rating">
              {[...Array(5)].map((_, i) => (
                <Star key={i} size={14} fill="currentColor" />
              ))}
            </div>
            <p className="quote-text">
              "We got our test results explained in plain language in just 10 minutes. Wish we had this years ago during our previous cycles. It gave us so much clarity."
            </p>
            <div className="author-info">
              <span className="author-name">Rahul & Sunita K.</span>
              <span className="author-meta">Pune</span>
            </div>
          </div>

          <div className="testimonial-card snap-slide">
            <div className="quote-icon">
              <QuoteIcon />
            </div>
            <div className="star-rating" aria-label="5 star rating">
              {[...Array(5)].map((_, i) => (
                <Star key={i} size={14} fill="currentColor" />
              ))}
            </div>
            <p className="quote-text">
              "The ability to get a reliable second opinion instantly at no cost is a game-changer. It helped us prepare our list of questions for our actual clinic visit."
            </p>
            <div className="author-info">
              <span className="author-name">Anonymous Patient</span>
              <span className="author-meta">Mumbai</span>
            </div>
          </div>
        </div>
      </section>

      {/* 7. CTA SECTION */}
      <section className="landing-cta-section fade-in-section">
        <div className="cta-box">
          <div className="cta-content">
            <h2 className="section-h2">Ready to Get Your IVF Queries Resolved?</h2>
            <p className="section-p">
              Talk to Dr. Malpani's AI Twin now — it is free, private, and available 24/7 to give you clear guidance and peace of mind.
            </p>
            <button
              className="btn-pill btn-green btn-large cta-btn-wide"
              onClick={onStartCall}
              aria-label="Start Your Free Consultation"
            >
              <Video size={18} />
              <span>Start Your Chat</span>
            </button>
            <span className="cta-footer-tip">No registration. No credit card. Just answers.</span>
          </div>
        </div>
      </section>

      {/* 8. FOOTER */}
      <footer className="landing-footer">
        <div className="footer-container">
          <div className="footer-bottom">
            <div className="footer-links">
              <a href="#" className="footer-link">Privacy Policy</a>
              <a href="#" className="footer-link">Terms of Service</a>
              <a href="https://www.drmalpani.com" target="_blank" rel="noopener noreferrer" className="footer-link">
                Clinic Website
              </a>
            </div>

            <a
              href="https://beyondchats.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="badge-link"
              aria-label="AI Consultation powered by BeyondChats"
            >
              <span className="powered-by-label">Powered by</span>
              <svg className="badge-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <rect x="1" y="1" width="14" height="12" rx="3" fill="currentColor" opacity="0.9"/>
                <path d="M4 13.5 L3 17 L7.5 14.5" fill="currentColor" opacity="0.9"/>
                <rect x="7" y="8" width="12" height="10" rx="3" fill="currentColor"/>
                <path d="M16 18 L17 21.5 L12.5 19" fill="currentColor"/>
              </svg>
              <span className="badge-name">BeyondChats</span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Inline decorative SVG icons to avoid external image requirements and keep code lightweight

function SparklesIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: 'var(--gold-mid)' }}
    >
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z" />
      <path d="m5 3 1 2.5L8.5 6 6 7 5 9.5 4 7 1.5 6 4 5.5Z" opacity="0.7" />
      <path d="m19 17 1 2.5 2.5.5-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1Z" opacity="0.7" />
    </svg>
  );
}


function QuoteIcon() {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M10 11H5.5C5.5 8 7 6.5 9 5.5L8 4C5 5.5 3.5 8 3.5 11.5V18H10V11ZM20.5 11H16C16 8 17.5 6.5 19.5 5.5L18.5 4C15.5 5.5 14 8 14 11.5V18H20.5V11Z" />
    </svg>
  );
}
