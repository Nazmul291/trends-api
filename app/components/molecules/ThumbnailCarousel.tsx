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
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftStartRef = useRef(0);
  const hasDraggedRef = useRef(false);

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
      const timer = setTimeout(updateScrollButtons, 350);
      return () => clearTimeout(timer);
    }
  }, [activeImageIndex, updateScrollButtons]);

  if (!hasMultipleImages) return null;

  const handleScrollLeft = () => {
    if (containerRef.current) {
      containerRef.current.scrollBy({ left: -140, behavior: "smooth" });
    }
  };

  const handleScrollRight = () => {
    if (containerRef.current) {
      containerRef.current.scrollBy({ left: 140, behavior: "smooth" });
    }
  };

  const handleThumbnailClick = (idx: number) => {
    // If the user just dragged, don't trigger click
    if (hasDraggedRef.current) {
      hasDraggedRef.current = false;
      return;
    }
    onSelectImage(idx);
    const item = itemRefs.current[idx];
    if (item) {
      item.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    isDraggingRef.current = true;
    hasDraggedRef.current = false;
    startXRef.current = e.pageX - containerRef.current.offsetLeft;
    scrollLeftStartRef.current = containerRef.current.scrollLeft;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current || !containerRef.current) return;
    const x = e.pageX - containerRef.current.offsetLeft;
    const distance = x - startXRef.current;
    if (Math.abs(distance) > 5) {
      hasDraggedRef.current = true;
    }
    containerRef.current.scrollLeft = scrollLeftStartRef.current - distance;
  };

  const handleMouseUpOrLeave = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!containerRef.current) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && Math.abs(e.deltaY) > 5) {
      containerRef.current.scrollLeft += e.deltaY;
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        position: "relative",
        gap: "6px",
      }}
    >
      <style>{`
        .thumbnail-carousel-scroll {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
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
            width: "28px",
            height: "28px",
            minWidth: "28px",
            borderRadius: "50%",
            border: "1px solid #d2d5d8",
            backgroundColor: "#ffffff",
            color: canScrollLeft ? "#202223" : "#c9cccf",
            cursor: canScrollLeft ? "pointer" : "not-allowed",
            boxShadow: canScrollLeft ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            opacity: canScrollLeft ? 1 : 0.35,
            transition: "all 0.15s ease",
            padding: 0,
            flexShrink: 0,
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}

      {/* Scroll Viewport: strictly constrained and forced to shrink */}
      <div
        ref={containerRef}
        className="thumbnail-carousel-scroll"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        onWheel={handleWheel}
        style={{
          display: "flex",
          flexDirection: "row",
          flexWrap: "nowrap",
          alignItems: "center",
          gap: "8px",
          overflowX: "auto",
          overflowY: "hidden",
          whiteSpace: "nowrap",
          scrollBehavior: isDraggingRef.current ? "auto" : "smooth",
          scrollSnapType: isDraggingRef.current ? "none" : "x mandatory",
          WebkitOverflowScrolling: "touch",
          padding: "4px 2px",
          width: "100%",
          maxWidth: "100%",
          minWidth: 0,
          flex: "1 1 0%",
          cursor: isScrollable ? "grab" : "default",
          userSelect: "none",
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
              onClick={() => handleThumbnailClick(idx)}
              style={{
                width: "60px",
                height: "60px",
                minWidth: "60px",
                maxWidth: "60px",
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
                draggable={false}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  display: "block",
                  pointerEvents: "none",
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
            width: "28px",
            height: "28px",
            minWidth: "28px",
            borderRadius: "50%",
            border: "1px solid #d2d5d8",
            backgroundColor: "#ffffff",
            color: canScrollRight ? "#202223" : "#c9cccf",
            cursor: canScrollRight ? "pointer" : "not-allowed",
            boxShadow: canScrollRight ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            opacity: canScrollRight ? 1 : 0.35,
            transition: "all 0.15s ease",
            padding: 0,
            flexShrink: 0,
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}
    </div>
  );
};
