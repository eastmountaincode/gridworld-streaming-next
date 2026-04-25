"use client";

import { useState } from "react";
import { ChevronDown, CircleQuestionMark, Globe } from "lucide-react";
import { FaInstagram, FaSpotify } from "react-icons/fa";

export function AboutShelf() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="about-shelf-container">
      <section className="legacy-collapse about-collapse">
        <button
          type="button"
          className="legacy-collapse-header"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((value) => !value)}
        >
          <span className="about-title-container">
            <span className="about-title">About</span>
            <CircleQuestionMark className="about-icon" aria-hidden="true" strokeWidth={1.9} />
          </span>
          <ChevronDown className={`collapse-chevron ${isExpanded ? "is-expanded" : ""}`} aria-hidden="true" />
        </button>

        <div
          className={`legacy-collapse-panel ${isExpanded ? "is-expanded" : ""}`}
          aria-hidden={!isExpanded}
          inert={isExpanded ? undefined : true}
        >
          <div className="legacy-collapse-content">
            <div className="about-body">
              <p>
                Hi, it&apos;s me{" "}
                <a href="https://www.instagram.com/ndrewboylan/" target="_blank" rel="noopener noreferrer">
                  Andrew
                </a>
                , the creator of <i>Gridworld</i>. I&apos;ve been releasing music on the internet for
                a decade now. As an artist, it&apos;s frustrating when there are people who want to
                support me, but the only way they can do that is through a site like Bandcamp that
                takes 15% PLUS processing fees, or a platform like Spotify that devalues smaller
                artists.
              </p>
              <p>
                I created <b>Gridworld Streaming</b>{" "}
                as a way for people to support my music with the
                minimum possible barrier in terms of processing fees. The site uses Square as a
                payment processor, which charges 2.9% + 30¢ per transaction, which is the lowest fee
                I&apos;ve found after researching such things.
              </p>
              <p>
                This is an experiment that asks, &quot;what does it look like for an artist to own their
                platform?&quot; If you are an artist / label / etc. that wants a site like this, or would
                like to create a non-traditional internet experience, get in touch and let&apos;s have a
                chat.
              </p>
              <p>andreweboylan /// at /// gmail /// dot /// com</p>
              <div className="social-icons-container">
                <a
                  href="https://andrew-boylan.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-icon"
                  aria-label="Andrew Boylan website"
                >
                  <Globe aria-hidden="true" strokeWidth={1.9} />
                </a>
                <a
                  href="https://open.spotify.com/artist/6150ZY2kIMKWAedOUXmfD4?si=BTEe-L5KQiye-_sfH4_lrw"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-icon"
                  aria-label="Andrew Boylan on Spotify"
                >
                  <FaSpotify aria-hidden="true" />
                </a>
                <a
                  href="https://www.instagram.com/ndrewboylan/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-icon"
                  aria-label="Andrew Boylan on Instagram"
                >
                  <FaInstagram aria-hidden="true" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
