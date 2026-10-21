import { Instagram, Facebook, MapPin, Phone, Mail, Clock } from 'lucide-react';

const TikTokIcon = ({ size = 18 }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round"
  >
    <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
  </svg>
);

export default function Footer() {
  return (
    <footer className="bg-[#060606] border-t border-orange-500/20 pt-20 pb-12 relative z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12 mb-20">
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="Mughal Dynasty Logo" className="h-12 w-auto" />
              <h3 className="text-2xl font-bold tracking-tighter text-orange-500">MUGHAL DYNASTY</h3>
            </div>
            <p className="text-gray-300 text-sm leading-relaxed">
              Experience the authentic flavors of the Mughal era. Our chefs use traditional recipes and the finest ingredients to bring you a truly royal dining experience.
            </p>
            <div className="flex gap-4">
              <a 
                href="https://www.instagram.com/mughal_dynasty_raunds/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="p-2 bg-white/10 rounded-full hover:bg-orange-500 text-white transition-all"
              >
                <Instagram size={18} />
              </a>
              <a 
                href="https://www.facebook.com/MughalDynastyIndianRestaurant/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="p-2 bg-white/10 rounded-full hover:bg-orange-500 text-white transition-all"
              >
                <Facebook size={18} />
              </a>
              <a 
                href="https://www.tiktok.com/@mughaldynasty" 
                target="_blank" 
                rel="noopener noreferrer"
                className="p-2 bg-white/10 rounded-full hover:bg-orange-500 text-white transition-all"
              >
                <TikTokIcon size={18} />
              </a>
            </div>
          </div>

          <div className="space-y-6">
            <h4 className="text-xs font-bold uppercase tracking-widest text-orange-500">Contact Us</h4>
            <div className="space-y-4">
              <div className="flex items-start gap-3 text-sm text-gray-200">
                <MapPin size={18} className="text-orange-500 flex-shrink-0 mt-0.5" />
                <span>17 High street raunds Wellingborough, Northamptonshire, NN9 6HS</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-200">
                <Phone size={18} className="text-orange-500 flex-shrink-0" />
                <span>
                  <a href="tel:01933626351" className="hover:text-orange-500 transition-colors">01933 626351</a> /{" "}
                  <a href="tel:01933623807" className="hover:text-orange-500 transition-colors">01933 623807</a>
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-200">
                <Mail size={18} className="text-orange-500 flex-shrink-0" />
                <span>
                  <a href="mailto:mughaldynastyrestaurant@gmail.com" className="hover:text-orange-500 transition-colors">
                    mughaldynastyrestaurant@gmail.com
                  </a>
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <h4 className="text-xs font-bold uppercase tracking-widest text-orange-500">Opening Hours</h4>
            <div className="space-y-4">
              <div className="flex items-start gap-3 text-sm text-gray-200">
                <Clock size={18} className="text-orange-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-white">Sun - Thu</p>
                  <p className="text-gray-300">17:00 - 21:30</p>
                </div>
              </div>
              <div className="flex items-start gap-3 text-sm text-gray-200">
                <Clock size={18} className="text-orange-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-white">Fri - Sat</p>
                  <p className="text-gray-300">16:30 - 22:30</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-12 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-6 text-xs text-gray-400 uppercase tracking-widest font-bold">
          <p>© 2026 MUGHAL DYNASTY. ALL RIGHTS RESERVED.</p>
          <div className="flex gap-8">
            <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
