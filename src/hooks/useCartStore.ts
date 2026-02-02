import { create } from "zustand";
import { persist } from "zustand/middleware";
import { RugProduct } from "../types/product";
import { isPriceOnRequestProduct } from "@/lib/productUtils";

interface CartItem {
  item: RugProduct;
  quantity: number;
  totalPrice: number;
}

interface CartStore {
  cart: CartItem[];
  addToCart: (product: RugProduct) => void;
  decreaseQuantity: (id: number) => void;
  increaseQuantity:(id: number) => void;
  removeFromCart: (id: number) => void;
  clearCart: () => void;
  totalItems: () => number;
  totalPrice: () => number;
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      cart: [],

      addToCart: (product) => {
        if (isPriceOnRequestProduct(product)) {
          return;
        }
        const cart = get().cart;
        const existing = cart.find((c) => c.item.id === product.id);
        // Очищаем запятые перед парсингом (1,390.00 -> 1390.00)
        const cleanPrice = product.price.replace(/,/g, '');
        const price = parseFloat(cleanPrice);

        if (existing) {
          set({
            cart: cart.map((c) =>
              c.item.id === product.id
                ? {
                    ...c,
                    quantity: c.quantity + 1,
                    totalPrice: (c.quantity + 1) * price,
                  }
                : c
            ),
          });
        } else {
          const newItem: CartItem = {
            item: product,
            quantity: 1,
            totalPrice: price,
          };
          set({ cart: [...cart, newItem] });
        }
      },

      decreaseQuantity: (id) => {
        const cart = get().cart;
        const existing = cart.find((c) => c.item.id === id);

        if (existing && existing.quantity > 1) {
          // Очищаем запятые перед парсингом
          const cleanPrice = existing.item.price.replace(/,/g, '');
          const price = parseFloat(cleanPrice);
          set({
            cart: cart.map((c) =>
              c.item.id === id
                ? {
                    ...c,
                    quantity: c.quantity - 1,
                    totalPrice: (c.quantity - 1) * price,
                  }
                : c
            ),
          });
        } else {
          set({ cart: cart.filter((c) => c.item.id !== id) });
        }
      },
increaseQuantity: (id) => {
  const cart = get().cart;
  const existing = cart.find((c) => c.item.id === id);

  if (existing) {
    // Очищаем запятые перед парсингом
    const cleanPrice = existing.item.price.replace(/,/g, '');
    const price = parseFloat(cleanPrice);
    set({
      cart: cart.map((c) =>
        c.item.id === id
          ? {
              ...c,
              quantity: c.quantity + 1,
              totalPrice: (c.quantity + 1) * price,
            }
          : c
      ),
    });
  }
},


      removeFromCart: (id) => {
        set({ cart: get().cart.filter((c) => c.item.id !== id) });
      },

      clearCart: () => {
        set({ cart: [] });
      },

      totalItems: () => {
        return get().cart.reduce((acc, c) => acc + c.quantity, 0);
      },

      totalPrice: () => {
        return get().cart.reduce((acc, c) => acc + c.totalPrice, 0);
      },
    }),
    { name: "cart" }
  )
);
