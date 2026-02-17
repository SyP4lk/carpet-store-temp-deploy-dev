"use client";

import { useEffect, useState } from "react";
import { Menu, Search } from "lucide-react";
import clsx from "clsx";
import useDrawerStore from "@/hooks/useDrawerStore";
import CartButton from "./cartButton";
import { useLocale } from "@/hooks/useLocale";
import Link from "next/link";
import { useDictionary } from "@/hooks/useDictionary";
import Image from "next/image";

interface NavbarProps {
  fixed?: boolean;
  mode?:string
}

const Navbar: React.FC<NavbarProps> = ({ fixed = false, mode="light" }) => {
  const [scrolled, setScrolled] = useState(false);
  const { open } = useDrawerStore()
  const [locale] = useLocale();
  const { dictionary } = useDictionary();

  useEffect(() => {
    if (fixed) return;

    const handleScroll = () => {
      if (window.scrollY > 80) {
        setScrolled(true);
      } else {
        setScrolled(false);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [fixed]);

  return (


    <header className={fixed ? "fixed top-0 w-full z-30" : ""}>
      <div className="w-full bg-black py-2">
        <div className="mx-auto max-w-screen-2xl px-2 sm:px-4 text-white">
          <div className="grid grid-cols-3 gap-2 text-[10px] font-light tracking-wide sm:hidden">
            <span className="min-w-0 text-center leading-tight [overflow-wrap:anywhere]">
              {dictionary?.header["custom-size"]}
            </span>
            <span className="min-w-0 text-center leading-tight [overflow-wrap:anywhere]">
              {dictionary?.header["custom-color"]}
            </span>
            <span className="min-w-0 text-center leading-tight [overflow-wrap:anywhere]">
              {dictionary?.header["custom-design"]}
            </span>
          </div>

          <div className="hidden sm:flex justify-center items-center gap-5 text-xs font-light tracking-wider">
            <span>{dictionary?.header["custom-size"]}</span>
            <span>|</span>
            <span>{dictionary?.header["custom-color"]}</span>
            <span>|</span>
            <span>{dictionary?.header["custom-design"]}</span>
          </div>
        </div>
      </div>

      <nav data-mode={mode} className="text-white w-full z-50 transition-all duration-500
      data-[mode='dark']:text-black">

        <div className="mx-auto px-4 md:px-10 flex items-center justify-between h-16">


          <div className="flex items-center gap-4 text-2xl font-bold cursor-pointer">
            <button className="cursor-pointer p-2 rounded-full transition"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                open("sidebar");
              }}>
              <Menu className="w-6 h-6" />
            </button>

            <Link href={`/${locale}`}>
              <Image
                src={`/logo-${mode}.png`}
                alt="Logo"
                width={850}
                height={430}
                priority
                className="w-30 object-contain"
              />
            </Link>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            <button className="cursor-pointer p-2 rounded-full transition"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                open("searchComp");
              }}>
              <Search className="size-4 md:size-6" />
            </button>
            <Link href={`/${locale}/cart`}>
              <CartButton />
            </Link>
          </div>
        </div>
      </nav>

      <nav className={clsx("shadow w-full z-50 transition-all duration-500 fixed -top-full bg-white text-black",
        scrolled && "top-0"
      )}>

        <div className="mx-auto px-4 md:px-10 flex items-center justify-between h-16">


          <div className="flex items-center gap-4 text-2xl font-bold cursor-pointer">
            <button className="cursor-pointer p-2 rounded-full transition"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                open("sidebar");
              }}>
              <Menu className="w-6 h-6" />
            </button>

            <Link href={`/${locale}`}>
              <Image
                src="/logo-dark.png"
                alt="Logo"
                width={850}
                height={430}
                priority
                className="w-30 object-contain"
              />
            </Link>
          </div>

          <div className="flex items-center gap-4">
            <button className="cursor-pointer p-2 rounded-full transition"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                open("searchComp");
              }}>
              <Search className="w-6 h-6" />
            </button>
            <Link href={`/${locale}/cart`}>

              <CartButton />
            </Link>

          </div>
        </div>
      </nav>
    </header>
  );
};

export default Navbar;
