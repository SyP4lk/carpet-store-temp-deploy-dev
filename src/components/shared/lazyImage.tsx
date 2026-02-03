"use client";

import clsx from "clsx";
import { Loader2, AlertTriangle, ImageIcon } from "lucide-react";
import Image, { ImageProps } from "next/image";
import { FC, useEffect, useRef, useState, useCallback } from "react";
import { shouldUnoptimizeImage, rewriteTicimaxImageUrl } from "@/lib/ticimaxImages";

type LazyImageProps = ImageProps & {
  className?: string;
  showPlaceholder?: boolean;
  placeholderClassName?: string;
  loadingClassName?: string;
  errorClassName?: string;
};

const LazyImage: FC<LazyImageProps> = ({
  className,
  alt,
  sizes,
  showPlaceholder = true,
  placeholderClassName,
  loadingClassName,
  errorClassName,
  onLoad,
  onError,
  ...props
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const wrapRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const imageLoadedRef = useRef(false);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(false);
    imageLoadedRef.current = false;
    setShouldLoad(false);
    setRetryCount(0);
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, [props.src]);

  useEffect(() => {
    if (!wrapRef.current || typeof window === 'undefined') return;

    const element = wrapRef.current;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          setIsVisible(true);
          setTimeout(() => setShouldLoad(true), 50);
        }
      },
      {
        threshold: 0.1,
        rootMargin: '50px'
      }
    );

    observerRef.current.observe(element);

    return () => {
      if (observerRef.current) {
        observerRef.current.unobserve(element);
        observerRef.current.disconnect();
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (props.priority || !showPlaceholder) {
      setIsVisible(true);
      setShouldLoad(true);
    }
  }, [props.priority, showPlaceholder]);

  const handleLoadStart = useCallback(() => {
    setLoading(true);
    setError(false);
  }, []);

  const handleLoadComplete = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    setLoading(false);
    setError(false);
    imageLoadedRef.current = true;
    onLoad?.(event);
  }, [onLoad]);

  const handleError = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const maxRetries = 3;

    // Логируем ошибку только в development
    if (process.env.NODE_ENV === 'development') {
      console.warn('Image loading error:', props.src);
    }

    if (retryCount < maxRetries) {
      // Попытка повторной загрузки через возрастающую задержку
      const delay = (retryCount + 1) * 2000; // 2s, 4s, 6s
      retryTimeoutRef.current = setTimeout(() => {
        setRetryCount(prev => prev + 1);
        setLoading(true);
        setError(false);
        // Принудительная перезагрузка изображения
        setShouldLoad(false);
        setTimeout(() => setShouldLoad(true), 100);
      }, delay);
    } else {
      setLoading(false);
      setError(true);
      imageLoadedRef.current = false;
      onError?.(event);
    }
  }, [onError, retryCount, props.src]);

  const wrapperStyles = props.fill 
    ? { position: 'absolute' as const, inset: 0 }
    : undefined;
  const normalizedSrc =
    typeof props.src === "string" ? rewriteTicimaxImageUrl(props.src) : props.src;
  return (
    <div
      ref={wrapRef}
      className={clsx("relative", className)}
      style={wrapperStyles}
    >
      {showPlaceholder && !imageLoadedRef.current && (
        <div 
          className={clsx(
            "absolute inset-0 bg-gray-200 flex items-center justify-center",
            placeholderClassName
          )}
        >
          {!isVisible ? (
            <ImageIcon className="w-8 h-8 text-gray-400" />
          ) : null}
        </div>
      )}

      {loading && (isVisible || !showPlaceholder) && !error && (
        <div 
          className={clsx(
            "absolute inset-0 flex items-center justify-center bg-gray-100/80 backdrop-blur-sm",
            loadingClassName
          )}
        >
          <div className="flex flex-col items-center space-y-2">
            <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
          </div>
        </div>
      )}

      {error && (
        <div
          className={clsx(
            "absolute inset-0 flex items-center justify-center bg-gray-50",
            errorClassName
          )}
          onClick={() => {
            // Повторная попытка при клике на ошибку
            setError(false);
            setLoading(true);
            setRetryCount(0);
            setShouldLoad(false);
            setTimeout(() => setShouldLoad(true), 100);
          }}
        >
          <div className="flex flex-col items-center space-y-2 text-gray-400 cursor-pointer hover:text-gray-600 transition-colors">
            <AlertTriangle className="w-6 h-6" />
            <span className="text-xs">Нажмите для повтора</span>
          </div>
        </div>
      )}

      {(shouldLoad || !showPlaceholder) && !error && props.src && (
        <Image
          {...props}
          src={normalizedSrc}
          alt={alt || "Image"}
          sizes={sizes || "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"}
          onLoadStart={handleLoadStart}
          onLoad={handleLoadComplete}
          onError={handleError}
          draggable={false}
          unoptimized={shouldUnoptimizeImage(normalizedSrc)}
          className={clsx(
            "transition-opacity duration-500 ease-out",
            loading ? "opacity-0" : "opacity-100",
            "select-none"
          )}
          style={{
            objectFit: 'cover',
            ...props.style
          }}
        />
      )}
    </div>
  );
};

export default LazyImage;