import React, { useRef, useEffect, useState, useCallback } from "react";
import type { ImageData } from "../../../shared/types/trends.types";

export interface ThumbnailCarouselProps {
  images: ImageData[];
  activeImageIndex: number;
  onSelectImage: (index: number) => void;
  productName?: string;
}

export const ThumbnailCarousel: React.FC<ThumbnailCarouselProps> = ({
  images,
  activeImageIndex,
  onSelectImage,
  productName = "Product",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const hasMultipleImages = images.length > 1;
  const isScrollable = images.length > 5;

  // Check scroll position to dynamically show/enable navigation arrows
  const updateScrollButtons = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 4);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 4);
  }, []);

  // Set up scroll and resize listeners
  useEffect(() => {
    updateScrollButtons();
    const el = containerRef.current;
    if (!el) return;

    el.addEventListener("scroll", updateScrollButtons, { passive: true });
    window.addEventListener("resize", updateScrollButtons);

    return () => {
      el.removeEventListener("scroll", updateScrollButtons);
      window.removeEventListener("resize", updateScrollButtons);
    };
  }, [images.length, updateScrollButtons]);

  // Auto-center the active thumbnail smoothly without vertical page jumps
  useEffect(() => {
    const activeItem = itemRefs.current[activeImageIndex];
    if (activeItem) {
      activeItem.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
      // Re-evaluate arrow states after animation
      const timer = setTimeout(updateScrollButtons, 350);
      return () => clearTimeout(timer);
    }
  }, [activeImageIndex, updateScrollButtons]);

  if (!hasMultipleImages) return null;

  const handleScrollLeft = () => {
    if (containerRef.current) {
      containerRef.current.scrollBy({ left: -144, behavior: "smooth" });
    }
  };

  const handleScrollRight = () => {
    if (containerRef.current) {
      containerRef.current.scrollBy({ left: 144, behavior: "smooth" });
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: isScrollable ? "space-between" : "center",
        width: "100%",
        position: "relative",
        gap: "6px",
      }}
    >
      <style>{`
        .thumbnail-carousel-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>

      {/* Left Navigation Arrow */}
      {isScrollable && (
        <button
          type="button"
          onClick={handleScrollLeft}
          disabled={!canScrollLeft}
          aria-label="Scroll thumbnails left"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "30px",
            height: "30px",
            minWidth: "30px",
            borderRadius: "50%",
            border: "1px solid #d2d5d8",
            backgroundColor: "#ffffff",
            color: canScrollLeft ? "#202223" : "#c9cccf",
            cursor: canScrollLeft ? "pointer" : "not-allowed",
            boxShadow: canScrollLeft ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            opacity: canScrollLeft ? 1 : 0.4,
            transition: "all 0.15s ease",
            padding: 0,
            flexShrink: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}

      {/* Constrained Horizontal Scroll Strip */}
      <div
        ref={containerRef}
        className="thumbnail-carousel-scroll"
        style={{
          display: "flex",
          gap: "8px",
          overflowX: "auto",
          scrollSnapType: "x mandatory",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          WebkitOverflowScrolling: "touch",
          padding: "4px 2px",
          maxWidth: isScrollable ? "calc(100% - 72px)" : "100%",
          flex: 1,
        }}
      >
        {images.map((img, idx) => {
          const isActive = activeImageIndex === idx;
          const altText = img.name || img.colour || `${productName} thumbnail ${idx + 1}`;

          return (
            <button
              key={idx}
              ref={(el) => {
                itemRefs.current[idx] = el;
              }}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={`Select ${altText}`}
              title={altText}
              onClick={() => onSelectImage(idx)}
              style={{
                width: "64px",
                height: "64px",
                minWidth: "64px",
                borderRadius: "8px",
                border: `2px solid ${isActive ? "#008060" : "#e1e3e5"}`,
                backgroundColor: "#f9fafb",
                padding: "2px",
                cursor: "pointer",
                overflow: "hidden",
                flexShrink: 0,
                scrollSnapAlign: "center",
                boxShadow: isActive ? "0 0 0 1px #008060, 0 1px 4px rgba(0, 128, 96, 0.2)" : "none",
                transform: isActive ? "scale(1.02)" : "scale(1)",
                transition: "all 0.15s ease",
              }}
            >
              <img
                src={img.link}
                alt={altText}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  display: "block",
                }}
              />
            </button>
          );
        })}
      </div>

      {/* Right Navigation Arrow */}
      {isScrollable && (
        <button
          type="button"
          onClick={handleScrollRight}
          disabled={!canScrollRight}
          aria-label="Scroll thumbnails right"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "30px",
            height: "30px",
            minWidth: "30px",
            borderRadius: "50%",
            border: "1px solid #d2d5d8",
            backgroundColor: "#ffffff",
            color: canScrollRight ? "#202223" : "#c9cccf",
            cursor: canScrollRight ? "pointer" : "not-allowed",
            boxShadow: canScrollRight ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            opacity: canScrollRight ? 1 : 0.4,
            transition: "all 0.15s ease",
            padding: 0,
            flexShrink: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}
    </div>
  );
};
