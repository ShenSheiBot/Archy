import React from 'react';
import PropTypes from 'prop-types';

import './style.css';

// Default quick access sites
const DEFAULT_SITES = [
  { name: 'ChatGPT', url: 'https://chat.openai.com', favicon: 'https://chat.openai.com/favicon.ico' },
  { name: 'Claude', url: 'https://claude.ai', favicon: 'https://claude.ai/favicon.ico' },
  { name: 'ShenShei', url: 'https://www.zhihu.com/people/sakuraayane_justice/', favicon: 'https://www.zhihu.com/favicon.ico' },
  null, // Empty slot
  null, // Empty slot
  null, // Empty slot
  null, // Empty slot
  null  // Empty slot
];

class QuickAccess extends React.Component {
  onKeyPress = (e) => {
    if (e.key === 'Enter') {
      this.props.onUrl(e.target.value);
    }
  };

  onSiteClick = (url) => {
    this.props.onUrl(url);
  };

  render() {
    const { className = '' } = this.props;

    return (
      <div className={ 'quick-access-page ' + className }>
        <input
          type="text"
          className="url-input"
          placeholder="Enter a URL..."
          onKeyPress={ this.onKeyPress }
          autoFocus
        />

        <div className="quick-access-grid">
          {DEFAULT_SITES.map((site, index) => {
            if (site) {
              return (
                <button
                  key={index}
                  className="quick-access-item"
                  onClick={() => this.onSiteClick(site.url)}
                  title={site.name}
                >
                  <img
                    src={site.favicon}
                    alt={site.name}
                    className="site-favicon"
                    onError={(e) => {
                      // Fallback to first letter if favicon fails to load
                      e.target.style.display = 'none';
                      e.target.nextSibling.style.display = 'flex';
                    }}
                  />
                  <div className="site-fallback" style={{ display: 'none' }}>
                    {site.name.charAt(0)}
                  </div>
                  <span className="site-name">{site.name}</span>
                </button>
              );
            } else {
              return (
                <div
                  key={index}
                  className="quick-access-item quick-access-empty"
                  title="Empty slot"
                >
                  <div className="empty-icon">+</div>
                </div>
              );
            }
          })}
        </div>
      </div>
    );
  }
}

QuickAccess.propTypes = {
  onUrl: PropTypes.func.isRequired,
  className: PropTypes.string
};

export default QuickAccess;
