import React from 'react';
import PropTypes from 'prop-types';

import './style.css';
import QuickAccess from '../quick-access';

class EmptyPage extends React.Component {
  render() {
    const { className = '', onUrl } = this.props;

    return (
      <div className={ 'empty-page ' + className }>
        <QuickAccess onUrl={onUrl} />
      </div>
    );
  }
}

EmptyPage.propTypes = {
  onUrl: PropTypes.func.isRequired,
  className: PropTypes.string
};

export default EmptyPage;
