import React from 'react';
import PropTypes from 'prop-types';

import './style.css';

// Use public URL directly instead of import for assets in public directory
const archyIcon = '/img/background-less.png';

class EmptyPage extends React.Component {
  onKeyPress = (e) => {
    if (e.key === 'Enter') {
      this.props.onUrl(e.target.value);
    }
  };

  render() {
    const { className = '' } = this.props;

    return (
      <div className={ 'empty-page ' + className }>
        <img src={archyIcon} alt="Archy" className="archy-logo" />
        <h1>Archy</h1>
        <p>Inspired by Archytas's pigeon – the world's first flying automaton</p>
        <input type="text" placeholder="Enter a URL you would like to see float" onKeyPress={ this.onKeyPress } autoFocus/>
      </div>
    );
  }
}

EmptyPage.propTypes = {
  onUrl: PropTypes.func.isRequired,
  className: PropTypes.string
};

export default EmptyPage;
